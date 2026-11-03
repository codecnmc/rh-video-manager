import type { DatabaseSync } from 'node:sqlite'
import type { AppPreferences } from '../../../shared/contracts/settings'
import type { AssetMcpPreferences } from '../../../shared/contracts/mcp'
import type { PreferencesRepository } from '../../modules/settings'

export class SqlitePreferencesRepository implements PreferencesRepository {
  constructor(private readonly database: DatabaseSync) {}
  read(): unknown {
    const row = this.database.prepare('SELECT data FROM app_preferences WHERE singleton = 1').get()
    return row ? JSON.parse(String(row.data)) as unknown : null
  }
  write(preferences: AppPreferences): void {
    this.database.prepare('INSERT INTO app_preferences (singleton, data) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data = excluded.data')
      .run(JSON.stringify(preferences))
  }
  readMcp(): unknown {
    const row = this.database.prepare('SELECT data FROM asset_mcp_preferences WHERE singleton = 1').get()
    return row ? JSON.parse(String(row.data)) as unknown : null
  }
  writeMcp(preferences: AssetMcpPreferences): void {
    this.database.prepare('INSERT INTO asset_mcp_preferences (singleton, data) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data = excluded.data')
      .run(JSON.stringify(preferences))
  }
}
