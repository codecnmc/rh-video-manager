import type { DatabaseSync } from 'node:sqlite'
import { routingSettingsSchema, type RoutingSettings } from '../../../../shared/contracts/generation-sources'
import type { GenerationSourcesRepository } from '../ports/sources'

export class SqliteGenerationSources implements GenerationSourcesRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec('CREATE TABLE IF NOT EXISTS generation_source_settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, data TEXT NOT NULL)')
  }
  load(): RoutingSettings {
    const row = this.database.prepare('SELECT data FROM generation_source_settings WHERE singleton=1').get()
    return row ? routingSettingsSchema.parse(JSON.parse(String(row.data))) : { revision: 0, sources: [], rules: [] }
  }
  save(settings: RoutingSettings, expectedRevision: number): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (this.load().revision !== expectedRevision) throw new Error('生成来源设置已变化，请重新载入')
      this.database.prepare('INSERT INTO generation_source_settings VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, data=excluded.data').run(settings.revision, JSON.stringify(settings))
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
