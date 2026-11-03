import type { DatabaseSync } from 'node:sqlite'
import { videoDraftSchema, type VideoDraft } from '../../../shared/contracts/video'
import type { VideoDraftRepository } from '../../modules/video'

export class SqliteVideoDraftRepository implements VideoDraftRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(projectId: string): VideoDraft[] {
    return this.database.prepare('SELECT data FROM video_drafts WHERE project_id = ? ORDER BY sort_order').all(projectId)
      .map((row) => videoDraftSchema.parse(JSON.parse(String(row.data))))
  }
  upsert(projectId: string, draft: VideoDraft, order: number): void {
    const existing = this.database.prepare('SELECT project_id FROM video_drafts WHERE id = ?').get(draft.id)
    if (existing && existing.project_id !== projectId) throw new Error('不能跨项目移动视频草稿')
    this.database.prepare(`INSERT INTO video_drafts (id, project_id, sort_order, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, data=excluded.data`)
      .run(draft.id, projectId, order, JSON.stringify(draft))
  }
}
