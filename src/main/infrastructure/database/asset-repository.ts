import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { assetSchema, categorySchema, type AssetCategory, type AssetFilter } from '../../../shared/contracts/assets'
import type { AssetRecord, AssetRepository, DraftAssetFolder } from '../../modules/assets'

export class SqliteAssetRepository implements AssetRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS asset_file_history (
      asset_id TEXT NOT NULL REFERENCES assets(id), updated_at TEXT NOT NULL,
      stored_name TEXT NOT NULL, data TEXT NOT NULL, replaced_at TEXT NOT NULL,
      PRIMARY KEY(asset_id, updated_at));`)
  }
  names(projectId: string): string[] {
    // 归档和软删除记录也占用名称序号，避免新图片与历史素材混淆。
    return this.database.prepare("SELECT json_extract(data, '$.name') AS name FROM assets WHERE project_id = ?")
      .all(projectId).map((row) => String(row.name))
  }
  list(filter: AssetFilter) {
    const where = ['deleted_at IS NULL', 'archived = ?']
    const values: SQLInputValue[] = [filter.archived ? 1 : 0]
    for (const [column, value] of [['project_id', filter.projectId], ['category_id', filter.categoryId]] as const) {
      if (value === undefined) continue
      if (value === null) where.push(`${column} IS NULL`)
      else { where.push(`${column} = ?`); values.push(value) }
    }
    if (filter.kind) { where.push('kind = ?'); values.push(filter.kind) }
    const assets = this.database.prepare(`SELECT data, archived FROM assets WHERE ${where.join(' AND ')} ORDER BY rowid DESC`).all(...values)
      .map((row) => assetSchema.parse({ ...JSON.parse(String(row.data)), archived: row.archived === 1 }))
    const search = filter.search?.trim().toLowerCase()
    return search ? assets.filter((asset) => [asset.name, ...asset.tags, asset.prompt, asset.notes].some((value) => value.toLowerCase().includes(search))) : assets
  }
  get(id: string): AssetRecord {
    const row = this.database.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!row) throw new Error('素材不存在')
    return { asset: assetSchema.parse({ ...JSON.parse(String(row.data)), archived: row.archived === 1 }),
      storedName: row.stored_name === null ? null : String(row.stored_name) }
  }
  save(records: AssetRecord[], folder?: DraftAssetFolder): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (folder) {
        const draft = this.database.prepare(`SELECT project_id FROM video_drafts WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE id = video_drafts.id OR id = video_drafts.project_id)`).get(folder.draftId)
        if (!draft || records.some(({ asset }) => asset.projectId !== draft.project_id || asset.categoryId !== folder.category.id)) throw new Error('视频草稿不存在或素材归属不一致')
        this.saveCategory(folder.category)
        this.database.prepare('INSERT INTO draft_asset_folders (draft_id, category_id) VALUES (?, ?) ON CONFLICT(draft_id) DO NOTHING')
          .run(folder.draftId, folder.category.id)
        if (this.draftCategory(folder.draftId)?.id !== folder.category.id) throw new Error('视频文件夹已变更，请重新粘贴')
      }
      const save = this.database.prepare(`INSERT INTO assets (id, project_id, category_id, kind, stored_name, data, archived)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,
        data=excluded.data, archived=excluded.archived`)
      for (const { asset, storedName } of records) {
        // 文件复制期间项目或素材可能已删除，提交时再次拒绝写回。
        if (this.database.prepare('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NOT NULL').get(asset.id) ||
          (asset.projectId && this.database.prepare('SELECT 1 FROM workspace_trash WHERE id = ?').get(asset.projectId))) throw new Error('素材或所属项目已删除')
        if (asset.categoryId && !this.database.prepare('SELECT 1 FROM asset_categories WHERE id = ? AND project_id IS ?').get(asset.categoryId, asset.projectId)) throw new Error('素材文件夹不存在或不属于该项目')
        save.run(asset.id, asset.projectId, asset.categoryId, asset.kind, storedName, JSON.stringify(asset), asset.archived ? 1 : 0)
      }
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  replaceFile(record: AssetRecord, expectedUpdatedAt: string): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.get(record.asset.id)
      if (previous.asset.updatedAt !== expectedUpdatedAt) throw new Error('素材已更新，请刷新后重新替换')
      if (previous.asset.kind !== 'image' || previous.asset.archived || !previous.storedName || !record.storedName ||
        record.storedName === previous.storedName || record.asset.kind !== previous.asset.kind || record.asset.projectId !== previous.asset.projectId) {
        throw new Error('素材替换类型或归属不正确')
      }
      if (previous.asset.projectId && this.database.prepare('SELECT 1 FROM workspace_trash WHERE id = ?').get(previous.asset.projectId)) throw new Error('所属项目已删除')
      // 草稿引用跟随当前文件；已提交任务快照必须保持原素材含义，不允许原位替换。
      if (this.database.prepare('SELECT 1 FROM generation_job_assets WHERE asset_id = ? LIMIT 1').get(record.asset.id)) throw new Error('素材已被视频任务快照引用，不能替换')
      this.database.prepare(`INSERT INTO asset_file_history (asset_id, updated_at, stored_name, data, replaced_at)
        VALUES (?, ?, ?, ?, ?)`).run(previous.asset.id, previous.asset.updatedAt, previous.storedName, JSON.stringify(previous.asset), record.asset.updatedAt)
      this.database.prepare('UPDATE assets SET stored_name = ?, data = ? WHERE id = ? AND deleted_at IS NULL')
        .run(record.storedName, JSON.stringify(record.asset), record.asset.id)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  remove(id: string): void {
    this.get(id)
    if (this.database.prepare('SELECT 1 FROM generation_job_assets WHERE asset_id = ? LIMIT 1').get(id)) {
      throw new Error('素材仍被视频任务快照引用，请保留历史参考素材')
    }
    if (this.database.prepare(`SELECT 1 FROM dialogue_takes t WHERE t.asset_id = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash w WHERE w.id = t.draft_id OR w.id = t.project_id) LIMIT 1`).get(id)) {
      throw new Error('素材仍被台词候选记录引用，请保留历史音频')
    }
    if (this.database.prepare(`SELECT 1 FROM draft_references r WHERE r.asset_id = ? AND r.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = r.draft_id) LIMIT 1`).get(id)) {
      throw new Error('素材仍被视频草稿引用，请先在生成设置中解除引用，或先删除对应草稿')
    }
    this.database.prepare('UPDATE assets SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }
  categories(projectId?: string | null): AssetCategory[] {
    const where = `NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = asset_categories.project_id)`
    return this.database.prepare(`SELECT id, name, parent_id AS parentId, project_id AS projectId FROM asset_categories
      WHERE ${where}${projectId === undefined ? '' : ' AND project_id IS ?'} ORDER BY name COLLATE NOCASE`)
      .all(...(projectId === undefined ? [] : [projectId])).map((row) => categorySchema.parse(row))
  }
  draftCategory(draftId: string): AssetCategory | undefined {
    const row = this.database.prepare(`SELECT c.id, c.name, c.parent_id AS parentId, c.project_id AS projectId FROM asset_categories c
      JOIN draft_asset_folders f ON f.category_id = c.id WHERE f.draft_id = ?`).get(draftId)
    return row ? categorySchema.parse(row) : undefined
  }
  saveCategory(category: AssetCategory): void {
    const projectId = category.projectId
    if (projectId !== null && !this.database.prepare(`SELECT 1 FROM projects p WHERE p.id = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = p.id)`).get(projectId)) throw new Error('文件夹所属项目不存在或已删除')
    const current = this.database.prepare('SELECT project_id FROM asset_categories WHERE id = ?').get(category.id)
    if (current && current.project_id !== projectId) throw new Error('不能更改文件夹的项目归属')
    if (category.parentId && !this.database.prepare('SELECT 1 FROM asset_categories WHERE id = ? AND project_id IS ?').get(category.parentId, projectId)) throw new Error('上级文件夹不属于该项目')
    this.database.prepare(`INSERT INTO asset_categories (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id`).run(category.id, category.name, category.parentId, projectId)
  }
  removeCategory(id: string): void {
    // 文件夹只能空着删除，防止归档素材被静默移到根目录。
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (!this.database.prepare('SELECT 1 FROM asset_categories WHERE id = ?').get(id)) throw new Error('文件夹不存在')
      if (this.database.prepare('SELECT 1 FROM asset_categories WHERE parent_id = ? LIMIT 1').get(id)) throw new Error('文件夹内仍有子文件夹，请先移动或删除子文件夹')
      if (this.database.prepare('SELECT 1 FROM assets WHERE category_id = ? AND deleted_at IS NULL LIMIT 1').get(id)) throw new Error('文件夹内仍有素材，请先移动素材（包含已归档）')
      // 已删除素材保留原 JSON 快照，但不再占用分类外键。
      this.database.prepare('UPDATE assets SET category_id = NULL WHERE category_id = ? AND deleted_at IS NOT NULL').run(id)
      this.database.prepare('DELETE FROM asset_categories WHERE id = ?').run(id)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
