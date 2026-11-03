import type { DatabaseSync } from 'node:sqlite'
import { libraryDocumentSchema, type LibraryDocument, type SaveLibraryDocument, type DeleteLibraryDocument, type AssignLibraryDocument } from '../../../shared/contracts/script-library'
import type { ScriptLibraryRepository } from '../../modules/scripts'

export class SqliteScriptLibraryRepository implements ScriptLibraryRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(projectId?: string | null): LibraryDocument[] {
    const scope = projectId === undefined ? '' : ' AND project_id IS ?'
    return this.database.prepare(`SELECT id, project_id AS projectId, title, markdown, revision, updated_at AS updatedAt FROM script_library
      WHERE deleted_at IS NULL AND (project_id IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_trash WHERE id = script_library.project_id))${scope}
      ORDER BY updated_at DESC, id`).all(...(projectId === undefined ? [] : [projectId]))
      .map((row) => libraryDocumentSchema.parse(row))
  }
  private activeProject(projectId: string | null): void {
    if (projectId !== null && !this.database.prepare(`SELECT 1 FROM projects WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE id = projects.id)`).get(projectId)) throw new Error('项目不存在或已删除')
  }
  save(input: SaveLibraryDocument, updatedAt: string): LibraryDocument {
    const projectId = input.projectId ?? null
    this.activeProject(projectId)
    if (input.expectedRevision === null) {
      if (this.database.prepare('SELECT 1 FROM script_library WHERE id = ?').get(input.id)) throw new Error('文档已存在，请重新载入')
      this.database.prepare('INSERT INTO script_library (id, project_id, title, markdown, revision, updated_at) VALUES (?, ?, ?, ?, 0, ?)')
        .run(input.id, projectId, input.title, input.markdown, updatedAt)
    } else {
      const result = this.database.prepare('UPDATE script_library SET title = ?, markdown = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND project_id IS ? AND deleted_at IS NULL')
        .run(input.title, input.markdown, updatedAt, input.id, input.expectedRevision, projectId)
      if (!result.changes) throw new Error('文档已变更或删除，请保留当前文字并重新载入')
    }
    return { id: input.id, projectId, title: input.title, markdown: input.markdown, revision: input.expectedRevision === null ? 0 : input.expectedRevision + 1, updatedAt }
  }
  remove(input: DeleteLibraryDocument, deletedAt: string): void {
    this.activeProject(input.projectId ?? null)
    const result = this.database.prepare('UPDATE script_library SET deleted_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND project_id IS ? AND deleted_at IS NULL')
      .run(deletedAt, input.id, input.expectedRevision, input.projectId ?? null)
    if (!result.changes) throw new Error('文档已变更或删除，请刷新后重试')
  }
  assign(input: AssignLibraryDocument, updatedAt: string): LibraryDocument {
    this.activeProject(input.projectId)
    // 只允许认领未归属文档，不能借此修改其他项目的归属或复活旧记录。
    const result = this.database.prepare(`UPDATE script_library SET project_id = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND project_id IS NULL AND deleted_at IS NULL`)
      .run(input.projectId, updatedAt, input.id, input.expectedRevision)
    if (!result.changes) throw new Error('文档已变更、删除或已归属项目，请刷新后重试')
    return this.list(input.projectId).find((document) => document.id === input.id)!
  }
  insertMany(documents: LibraryDocument[]): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const document of documents) this.save({ ...document, expectedRevision: null }, document.updatedAt)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
