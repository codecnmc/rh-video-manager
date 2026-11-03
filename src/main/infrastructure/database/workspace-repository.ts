import { DatabaseSync } from 'node:sqlite'
import type { WorkspaceRepository } from '../../application/workspace-repository'
import { workspaceSchema, type DeleteWorkspaceEntity, type Workspace } from '../../../shared/contracts/workspace'
import type { ProjectService } from '../../modules/projects'
import type { ScriptService } from '../../modules/scripts'
import type { VideoService } from '../../modules/video'
import { migrateWorkbench, workbenchSchemaVersion } from './migrations'

export class WorkbenchDatabase {
  readonly connection: DatabaseSync

  constructor(path: string) {
    this.connection = new DatabaseSync(path)
    const version = this.connection.prepare('PRAGMA user_version').get()
    const schemaVersion = Number(version?.user_version ?? 0)
    if (schemaVersion > workbenchSchemaVersion) {
      this.connection.close()
      throw new Error('数据库版本高于当前应用支持范围，未执行修改')
    }
    this.connection.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS workspace_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sample INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, script TEXT NOT NULL, sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shots (
        id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        title TEXT NOT NULL, description TEXT NOT NULL, prompt TEXT NOT NULL,
        duration INTEGER NOT NULL CHECK (duration BETWEEN 4 AND 15),
        aspect_ratio TEXT NOT NULL, resolution TEXT NOT NULL, instance TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
    `)
    migrateWorkbench(this.connection, schemaVersion)
  }

  close(): void { this.connection.close() }
}

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: DatabaseSync, private readonly projects: ProjectService,
    private readonly scripts: ScriptService, private readonly videos: VideoService,
    private readonly copyReferences?: (sourceDraftId: string, targetDraftId: string, projectId: string) => void) {}

  async read(): Promise<Workspace | null> {
    const meta = this.database.prepare('SELECT revision, updated_at FROM workspace_meta WHERE singleton = 1').get()
    if (!meta) return null
    const deleted = new Set(this.database.prepare('SELECT id FROM workspace_trash').all().map((row) => String(row.id)))
    return workspaceSchema.parse({
      version: 1, revision: meta.revision, updatedAt: meta.updated_at,
      projects: this.projects.list().filter((project) => !deleted.has(project.id)).map((project) => ({ ...project,
        episodes: this.scripts.list(project.id).filter((episode) => !deleted.has(episode.id)),
        videoDrafts: this.videos.list(project.id).filter((draft) => !deleted.has(draft.id)) }))
    })
  }

  async write(workspace: Workspace, copyReferences?: { sourceDraftId: string; targetDraftId: string; projectId: string }): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const meta = this.database.prepare('SELECT revision FROM workspace_meta WHERE singleton = 1').get()
      if (meta && Number(meta.revision) + 1 !== workspace.revision) throw new Error('草稿版本冲突，请重新载入')
      const deleted = this.database.prepare('SELECT 1 FROM workspace_trash WHERE id = ?')
      const ids = workspace.projects.flatMap((project) => [project.id, ...project.episodes.map((episode) => episode.id), ...project.videoDrafts.map((draft) => draft.id)])
      if (ids.some((id) => deleted.get(id))) throw new Error('不能覆盖已删除的数据，请重新载入')
      workspace.projects.forEach((project, projectOrder) => {
        this.projects.save(project, projectOrder)
        project.episodes.forEach((episode, episodeOrder) => {
          this.scripts.save(project.id, episode, episodeOrder)
        })
        project.videoDrafts.forEach((draft, draftOrder) => this.videos.save(project.id, draft, draftOrder))
      })
      if (copyReferences) {
        if (!this.copyReferences) throw new Error('草稿引用复制服务不可用')
        this.copyReferences(copyReferences.sourceDraftId, copyReferences.targetDraftId, copyReferences.projectId)
      }
      this.database.prepare(`INSERT INTO workspace_meta VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at`)
        .run(workspace.revision, workspace.updatedAt)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async remove(input: DeleteWorkspaceEntity): Promise<void> {
    const current = await this.read()
    if (!current || current.revision !== input.expectedRevision) throw new Error('项目已更新，请重新载入后再删除')
    const project = current.projects.find((item) => item.id === input.projectId)
    const entity = input.kind === 'project' ? project : input.kind === 'episode'
      ? project?.episodes.find((item) => item.id === input.id) : project?.videoDrafts.find((item) => item.id === input.id)
    if (!project || !entity || entity.id !== input.id) throw new Error('待删除的数据不存在')
    const now = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const meta = this.database.prepare('SELECT revision FROM workspace_meta WHERE singleton = 1').get()
      if (meta?.revision !== input.expectedRevision) throw new Error('项目已更新，请重新载入后再删除')
      const save = this.database.prepare('INSERT INTO workspace_trash VALUES (?, ?, ?, ?, ?)')
      save.run(entity.id, input.kind, project.id, JSON.stringify(entity), now)
      if (input.kind === 'project') {
        for (const episode of project.episodes) save.run(episode.id, 'episode', project.id, JSON.stringify(episode), now)
        for (const draft of project.videoDrafts) save.run(draft.id, 'video', project.id, JSON.stringify(draft), now)
        this.database.prepare('UPDATE assets SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL').run(now, project.id)
      }
      this.database.prepare('UPDATE workspace_meta SET revision = revision + 1, updated_at = ? WHERE singleton = 1').run(now)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
