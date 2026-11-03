import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  extensionIdSchema, extensionStorageManifestSchema, extensionStorageOperationSchema, extensionStorageValueSchema,
  type ExtensionStorageManifest, type ExtensionStorageOperation
} from '../../../shared/contracts/extensions'

const tableName = (name: string) => `records_${createHash('sha256').update(name).digest('hex')}`

async function regularPath(path: string, directory: boolean): Promise<void> {
  const info = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (info && (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1))) {
    throw new Error('插件存储路径不能使用链接或特殊文件')
  }
}

/** 每个会话持有独立连接；不接收本体连接、文件路径、SQL 或调用者自报的插件身份。 */
export class ExtensionStorageSession {
  private closed = false
  private constructor(private readonly database: DatabaseSync, private readonly tables: ReadonlySet<string>) {}

  static async open(root: string, id: string, declaration?: ExtensionStorageManifest): Promise<ExtensionStorageSession> {
    const owner = extensionIdSchema.parse(id)
    const schema = declaration === undefined ? undefined : extensionStorageManifestSchema.parse(declaration)
    const directory = resolve(root)
    await regularPath(directory, true)
    await mkdir(directory, { recursive: true })
    const canonical = resolve(await realpath(directory))
    if (process.platform === 'win32' ? canonical.toLowerCase() !== directory.toLowerCase() : canonical !== directory) throw new Error('插件存储根目录不能重定向')
    const path = join(directory, `${createHash('sha256').update(owner).digest('hex')}.sqlite`)
    for (const suffix of ['', '-wal', '-shm', '-journal']) await regularPath(path + suffix, false)
    const database = new DatabaseSync(path)
    try {
      database.exec('PRAGMA busy_timeout = 5000; PRAGMA max_page_count = 16384; BEGIN IMMEDIATE')
      database.exec(`CREATE TABLE IF NOT EXISTS storage_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT NOT NULL, version INTEGER NOT NULL, tables TEXT NOT NULL
      )`)
      const current = database.prepare('SELECT owner, version, tables FROM storage_owner WHERE singleton = 1').get()
      const version = schema?.version ?? 0
      const tables = [...(schema?.tables ?? [])].sort()
      if (current && (current.owner !== owner || Number(current.version) > version)) throw new Error('插件存储归属不符或版本回退')
      if (current && Number(current.version) === version && current.tables !== JSON.stringify(tables)) throw new Error('插件存储声明变化必须提升版本')
      // 只新增声明的记录表，不执行插件 SQL，不删除升级时未声明的历史表。
      for (const table of tables) database.exec(`CREATE TABLE IF NOT EXISTS ${tableName(table)} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
      database.prepare(`INSERT INTO storage_owner VALUES (1, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET version=excluded.version, tables=excluded.tables`).run(owner, version, JSON.stringify(tables))
      database.exec('COMMIT')
      return new ExtensionStorageSession(database, new Set(tables))
    } catch (error) {
      try { database.exec('ROLLBACK') } finally { database.close() }
      throw error
    }
  }

  execute(input: ExtensionStorageOperation): unknown {
    if (this.closed) throw new Error('插件存储会话已撤销')
    const operation = extensionStorageOperationSchema.parse(input)
    if (!this.tables.has(operation.table)) throw new Error('插件未声明此数据表')
    const table = tableName(operation.table)
    if (operation.operation === 'set') {
      this.database.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(operation.key, JSON.stringify(operation.value))
      return null
    }
    if (operation.operation === 'delete') {
      this.database.prepare(`DELETE FROM ${table} WHERE key = ?`).run(operation.key)
      return null
    }
    const decode = (row: Record<string, unknown>) => ({ key: String(row.key), value: extensionStorageValueSchema.parse(JSON.parse(String(row.value))) })
    if (operation.operation === 'get') {
      const row = this.database.prepare(`SELECT key, value FROM ${table} WHERE key = ?`).get(operation.key)
      return row ? decode(row) : null
    }
    const rows = operation.after === undefined
      ? this.database.prepare(`SELECT key, value FROM ${table} ORDER BY key LIMIT ?`).all(operation.limit)
      : this.database.prepare(`SELECT key, value FROM ${table} WHERE key > ? ORDER BY key LIMIT ?`).all(operation.after, operation.limit)
    return rows.map(decode)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }
}
