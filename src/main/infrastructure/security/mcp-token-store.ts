import { safeStorage } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { assetMcpTokenSchema } from '../../../shared/contracts/mcp'
import type { AssetMcpTokenStore } from '../../mcp/asset-server'

export class SqliteMcpTokenStore implements AssetMcpTokenStore {
  constructor(private readonly database: DatabaseSync) {
    database.exec('CREATE TABLE IF NOT EXISTS asset_mcp_credential (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), cipher BLOB NOT NULL)')
  }
  read(): string | null {
    const row = this.database.prepare('SELECT cipher FROM asset_mcp_credential WHERE singleton = 1').get()
    if (!row) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取 MCP 令牌')
    if (!(row.cipher instanceof Uint8Array)) throw new Error('MCP 令牌存储格式不正确')
    try { return assetMcpTokenSchema.parse(safeStorage.decryptString(Buffer.from(row.cipher))) }
    catch { throw new Error('无法解密 MCP 令牌，请在原系统使用') }
  }
  write(token: string): void {
    const parsed = assetMcpTokenSchema.parse(token)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，未保存 MCP 令牌')
    this.database.prepare('INSERT INTO asset_mcp_credential (singleton, cipher) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET cipher = excluded.cipher')
      .run(safeStorage.encryptString(parsed))
  }
}
