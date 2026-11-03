import type { DatabaseSync } from 'node:sqlite'
import { dialoguePlanSchema, dialogueTakeSchema, projectVoicesSchema, type DialoguePlan, type DialogueTake, type ProductionScope, type ProjectVoices } from '../../../shared/contracts/production'
import type { ProductionRepository } from '../../modules/production'

export class SqliteProductionRepository implements ProductionRepository {
  constructor(private readonly database: DatabaseSync) {
    // 这些是宿主生产模块的表，不是插件表；模块装配时补齐缺失结构，不改业务记录或全局版本。
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(`CREATE TABLE IF NOT EXISTS dialogue_plans (
        draft_id TEXT PRIMARY KEY REFERENCES video_drafts(id), project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dialogue_takes (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES video_drafts(id), project_id TEXT NOT NULL REFERENCES projects(id),
        asset_id TEXT REFERENCES assets(id), data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS dialogue_takes_scope ON dialogue_takes(project_id, draft_id);
      CREATE TABLE IF NOT EXISTS production_defaults (project_id TEXT PRIMARY KEY REFERENCES projects(id), data TEXT NOT NULL);
      COMMIT;`)
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }
  private ensureScope(scope: ProductionScope): void {
    if (!this.database.prepare(`SELECT 1 FROM video_drafts d WHERE d.id = ? AND d.project_id = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash w WHERE w.id = d.id OR w.id = d.project_id)`).get(scope.draftId, scope.projectId)) throw new Error('草稿已删除或不属于当前项目')
  }
  plan(scope: ProductionScope): DialoguePlan {
    const row = this.database.prepare('SELECT data FROM dialogue_plans WHERE draft_id = ? AND project_id = ?').get(scope.draftId, scope.projectId)
    return row ? dialoguePlanSchema.parse(JSON.parse(String(row.data))) : { projectId: scope.projectId, draftId: scope.draftId, revision: 0, enabled: false, lines: [] }
  }
  savePlan(plan: DialoguePlan): DialoguePlan {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.ensureScope(plan)
      if (this.plan(plan).revision !== plan.revision) throw new Error('台词配置已被更新，请重新载入，未覆盖其他修改')
      const next = { ...plan, revision: plan.revision + 1 }
      this.database.prepare(`INSERT INTO dialogue_plans (draft_id, project_id, data) VALUES (?, ?, ?)
        ON CONFLICT(draft_id) DO UPDATE SET data=excluded.data`).run(plan.draftId, plan.projectId, JSON.stringify(next))
      this.database.exec('COMMIT')
      return next
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  takes(scope: ProductionScope): DialogueTake[] {
    return this.database.prepare('SELECT data FROM dialogue_takes WHERE draft_id = ? AND project_id = ? ORDER BY rowid DESC').all(scope.draftId, scope.projectId)
      .map((row) => dialogueTakeSchema.parse(JSON.parse(String(row.data))))
  }
  allTakes(): DialogueTake[] {
    return this.database.prepare(`SELECT t.data FROM dialogue_takes t WHERE NOT EXISTS (
      SELECT 1 FROM workspace_trash w WHERE w.id = t.draft_id OR w.id = t.project_id) ORDER BY t.rowid DESC`).all()
      .map((row) => dialogueTakeSchema.parse(JSON.parse(String(row.data))))
  }
  saveTake(take: DialogueTake): void {
    if (!this.database.prepare('SELECT 1 FROM dialogue_takes WHERE id = ?').get(take.id)) this.ensureScope(take)
    this.database.prepare(`INSERT INTO dialogue_takes (id, draft_id, project_id, asset_id, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET asset_id=excluded.asset_id, data=excluded.data`).run(take.id, take.draftId, take.projectId, take.assetId, JSON.stringify(take))
  }
  adopt(take: DialogueTake): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const item of this.takes(take)) {
        if (item.line.id === take.line.id) this.saveTake({ ...item, adopted: item.id === take.id })
      }
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  interruptPending(): void {
    const rows = this.database.prepare('SELECT data FROM dialogue_takes').all()
    for (const row of rows) {
      const take = dialogueTakeSchema.parse(JSON.parse(String(row.data)))
      if (['queued', 'running', 'cancelling'].includes(take.status)) this.saveTake({ ...take, status: 'interrupted',
        finishedAt: new Date().toISOString(), error: '应用已关闭或上次执行中断；未自动重试，云端结果需单独核对' })
    }
  }
  projectVoices(projectId: string): ProjectVoices {
    const row = this.database.prepare('SELECT data FROM production_defaults WHERE project_id = ?').get(projectId)
    return row ? projectVoicesSchema.parse(JSON.parse(String(row.data))) : { projectId, revision: 0, bindings: [] }
  }
  saveProjectVoices(voices: ProjectVoices): ProjectVoices {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (this.database.prepare('SELECT 1 FROM workspace_trash WHERE id = ?').get(voices.projectId)) throw new Error('项目已删除')
      if (this.projectVoices(voices.projectId).revision !== voices.revision) throw new Error('项目音色绑定已更新，请重新载入')
      const next = { ...voices, revision: voices.revision + 1 }
      this.database.prepare(`INSERT INTO production_defaults VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data`)
        .run(voices.projectId, JSON.stringify(next))
      this.database.exec('COMMIT')
      return next
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
