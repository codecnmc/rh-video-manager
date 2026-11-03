import type { DatabaseSync } from 'node:sqlite'

// 可执行程序位置仅保存在主进程 SQLite，不进入草稿、导出或 MCP。
export class SqliteContinuityEngineRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec('CREATE TABLE IF NOT EXISTS continuity_engine (id INTEGER PRIMARY KEY CHECK (id = 1), executable TEXT NOT NULL)')
  }
  read(): string | undefined {
    const row = this.database.prepare('SELECT executable FROM continuity_engine WHERE id = 1').get()
    return row ? String(row.executable) : undefined
  }
  write(executable: string): void {
    this.database.prepare('INSERT INTO continuity_engine (id, executable) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET executable=excluded.executable').run(executable)
  }
}
