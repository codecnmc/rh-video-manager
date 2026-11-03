import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { ReferenceRecord, ReferenceRepository } from '../../modules/assets'
import type { ReferenceKind } from '../../../shared/contracts/references'

const referenceSchema = z.object({
  id: z.string().uuid(), draftId: z.string().uuid(), assetId: z.string().uuid(), kind: z.enum(['image', 'video', 'audio']),
  label: z.string(), name: z.string(), size: z.number(), ordinal: z.number()
})
const select = `SELECT r.*, a.data AS asset_data FROM draft_references r JOIN assets a ON a.id = r.asset_id`

export class SqliteReferenceRepository implements ReferenceRepository {
  constructor(private readonly database: DatabaseSync) {}
  private read(row: Record<string, unknown>): ReferenceRecord {
    const asset = z.object({ name: z.string(), size: z.number() }).parse(JSON.parse(String(row.asset_data)))
    return referenceSchema.parse({ id: row.id, draftId: row.draft_id, assetId: row.asset_id, kind: row.kind, label: row.label,
      name: asset.name, size: asset.size, ordinal: row.ordinal })
  }
  list(draftId: string): ReferenceRecord[] {
    return this.database.prepare(`${select} WHERE r.draft_id = ? AND r.removed_at IS NULL ORDER BY r.rowid`).all(draftId).map((row) => this.read(row))
  }
  get(id: string): ReferenceRecord {
    const row = this.database.prepare(`${select} WHERE r.id = ? AND r.removed_at IS NULL`).get(id)
    if (!row) throw new Error('参考素材不存在')
    return this.read(row)
  }
  nextOrdinal(draftId: string, kind: ReferenceKind): number {
    const used = new Set(this.database.prepare(`SELECT ordinal FROM draft_references
      WHERE draft_id = ? AND kind = ? AND removed_at IS NULL`).all(draftId, kind).map((row) => Number(row.ordinal)))
    // 仅复用已释放的编号，不重排有效引用，避免提示词中的标签指向变化。
    let ordinal = 1
    while (used.has(ordinal)) ordinal += 1
    return ordinal
  }
  save(records: ReferenceRecord[]): void {
    this.database.exec('SAVEPOINT save_draft_references')
    try {
      const statement = this.database.prepare(`INSERT INTO draft_references (id, draft_id, asset_id, kind, label, ordinal)
        VALUES (?, ?, ?, ?, ?, ?)`)
      for (const record of records) {
        if (this.database.prepare('SELECT 1 FROM workspace_trash WHERE id = ?').get(record.draftId)) throw new Error('视频草稿已删除')
        statement.run(record.id, record.draftId, record.assetId, record.kind, record.label, record.ordinal)
      }
      this.database.exec('RELEASE SAVEPOINT save_draft_references')
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT save_draft_references')
      this.database.exec('RELEASE SAVEPOINT save_draft_references')
      throw error
    }
  }
  detach(id: string): void { this.database.prepare('UPDATE draft_references SET removed_at = ? WHERE id = ?').run(new Date().toISOString(), id) }
  replace(id: string, expectedAssetId: string, assetId: string): void {
    // 单条条件更新保留引用 ID、编号和标签，不经解除再绑定的中间状态。
    const result = this.database.prepare(`UPDATE draft_references SET asset_id = ? WHERE id = ? AND asset_id = ? AND removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = draft_references.draft_id)`)
      .run(assetId, id, expectedAssetId)
    if (result.changes !== 1) throw new Error('引用已变化或草稿已删除，请重新载入')
  }
}
