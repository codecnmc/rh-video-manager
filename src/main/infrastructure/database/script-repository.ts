import type { DatabaseSync } from 'node:sqlite'
import { episodeSchema, type Episode } from '../../../shared/contracts/workspace'
import type { ScriptRepository } from '../../modules/scripts'

export class SqliteScriptRepository implements ScriptRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(projectId: string): Episode[] {
    return this.database.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY sort_order').all(projectId).map((episode) => {
      return episodeSchema.parse({
        id: episode.id, title: episode.title, script: episode.script
      })
    })
  }

  upsert(projectId: string, episode: Episode, order: number): void {
    const existing = this.database.prepare('SELECT project_id FROM episodes WHERE id = ?').get(episode.id)
    if (existing && existing.project_id !== projectId) throw new Error('不能跨项目移动分集')
    this.database.prepare(`INSERT INTO episodes (id, project_id, title, script, sort_order) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, script=excluded.script, sort_order=excluded.sort_order`)
      .run(episode.id, projectId, episode.title, episode.script, order)
  }
}
