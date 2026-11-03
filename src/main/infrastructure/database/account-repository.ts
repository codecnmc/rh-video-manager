import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { accountQueueSchema } from '../../../shared/contracts/accounts'
import type { AccountRecord, AccountRepository } from '../../modules/accounts'

const accountSchema = z.object({
  id: z.string().uuid(), name: z.string(), identity: z.string(), keyHint: z.string(),
  concurrency: z.number().int(), enabled: z.boolean(), status: z.enum(['unknown', 'ready', 'error']),
  checkedAt: z.string().nullable(), error: z.string(), balance: z.object({
    coins: z.string(), money: z.string().nullable(), currency: z.string().nullable(), runningTasks: z.number(), apiType: z.string()
  }).nullable(),
  queue: accountQueueSchema.nullable().default(null),
  queueStatus: z.enum(['unknown', 'ready', 'error']).default('unknown'),
  queueCheckedAt: z.string().nullable().default(null), queueError: z.string().default('')
})

export class SqliteAccountRepository implements AccountRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(): AccountRecord[] {
    return this.database.prepare('SELECT data, key_cipher, key_fingerprint FROM accounts ORDER BY rowid').all().map((row) => {
      if (!(row.key_cipher instanceof Uint8Array)) throw new Error('账号凭据格式不正确')
      return { ...accountSchema.parse(JSON.parse(String(row.data)) as unknown), cipher: row.key_cipher, fingerprint: String(row.key_fingerprint) }
    })
  }
  save(record: AccountRecord): void {
    const { cipher, fingerprint, ...account } = record
    this.database.prepare(`INSERT INTO accounts (id, identity, key_fingerprint, key_cipher, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET identity=excluded.identity, key_fingerprint=excluded.key_fingerprint,
      key_cipher=excluded.key_cipher, data=excluded.data`)
      .run(record.id, record.identity, fingerprint, cipher, JSON.stringify(account))
  }
  remove(id: string): void { this.database.prepare('DELETE FROM accounts WHERE id = ?').run(id) }
}
