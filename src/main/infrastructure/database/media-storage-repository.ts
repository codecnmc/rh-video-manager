import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { MediaStorageRepository, MediaStorageState } from '../../modules/settings'

const stateSchema = z.strictObject({
  directory: z.string().min(1).max(3000).nullable(),
  pendingDirectory: z.string().min(1).max(3000).nullable(),
  cleanupDirectory: z.string().min(1).max(3000).nullable()
})

export class SqliteMediaStorageRepository implements MediaStorageRepository {
  constructor(private readonly database: DatabaseSync) {}
  read(): MediaStorageState {
    const row = this.database.prepare('SELECT data FROM media_storage_settings WHERE singleton = 1').get()
    return row ? stateSchema.parse(JSON.parse(String(row.data)) as unknown)
      : { directory: null, pendingDirectory: null, cleanupDirectory: null }
  }
  write(state: MediaStorageState): void {
    this.database.prepare(`INSERT INTO media_storage_settings (singleton, data) VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET data = excluded.data`).run(JSON.stringify(stateSchema.parse(state)))
  }
}
