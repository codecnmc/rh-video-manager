import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { extensionIdSchema, extensionSettingsSchema } from '../../../shared/contracts/extensions'
import { parseExtensionManifest, type ExtensionRecord, type ExtensionRepository } from '../../modules/extensions'

const recordSchema = z.object({
  id: extensionIdSchema, manifest: z.unknown(), packageKey: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(), installedAt: z.string().datetime(), settings: extensionSettingsSchema, configurationRevision: z.number().int().nonnegative().optional()
})

export class SqliteExtensionRepository implements ExtensionRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(): ExtensionRecord[] {
    return this.database.prepare('SELECT data FROM extensions WHERE installed = 1 ORDER BY id').all().map((row) => {
      const record = recordSchema.parse(JSON.parse(String(row.data)))
      return { ...record, configurationRevision: record.configurationRevision ?? 0, manifest: parseExtensionManifest(record.manifest) }
    })
  }
  save(record: ExtensionRecord): void {
    this.database.prepare(`INSERT INTO extensions (id, data, installed) VALUES (?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, installed = 1`).run(record.id, JSON.stringify(record))
  }
  remove(id: string): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE extensions SET installed = 0 WHERE id = ?').run(id)
      this.database.prepare('DELETE FROM extension_secrets WHERE extension_id = ?').run(id)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  secretKeys(id: string): string[] {
    return this.database.prepare('SELECT key FROM extension_secrets WHERE extension_id = ? ORDER BY key').all(id).map((row) => String(row.key))
  }
  readSecrets(id: string): Record<string, Uint8Array> {
    return Object.fromEntries(this.database.prepare('SELECT key, cipher FROM extension_secrets WHERE extension_id = ?').all(id).map((row) => {
      if (!(row.cipher instanceof Uint8Array)) throw new Error('插件凭据记录损坏')
      return [String(row.key), row.cipher]
    }))
  }
  saveSecret(id: string, key: string, cipher: Uint8Array | null, configurationRevision?: number): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (cipher === null) this.database.prepare('DELETE FROM extension_secrets WHERE extension_id = ? AND key = ?').run(id, key)
      else this.database.prepare(`INSERT INTO extension_secrets VALUES (?, ?, ?)
        ON CONFLICT(extension_id, key) DO UPDATE SET cipher = excluded.cipher`).run(id, key, cipher)
      if (configurationRevision !== undefined) this.database.prepare(`UPDATE extensions SET data = json_set(data, '$.configurationRevision', ?) WHERE id = ?`).run(configurationRevision, id)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
