import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { imageAccountSchema, imageBoardSchema, imageNodeSchema, imageExecutionSettingsSchema, type ImageBoard, type ImageNode, type ImageExecutionSettings } from '../../../../shared/contracts/image-generation'
import type { ImageAccountRecord, ImageGenerationRepository, ImageSubmissionReceipt } from '../ports/image-generation'

export class SqliteImageGenerationRepository implements ImageGenerationRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS image_accounts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, cipher BLOB NOT NULL, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS image_boards (id TEXT PRIMARY KEY, project_id TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS image_nodes (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS image_nodes_board ON image_nodes(board_id);
      CREATE TABLE IF NOT EXISTS image_node_refs (node_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(node_id, asset_id));
      CREATE TABLE IF NOT EXISTS image_outputs (node_id TEXT PRIMARY KEY, cipher BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS image_submission_requests (request_key TEXT PRIMARY KEY, input TEXT NOT NULL, node_ids TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS image_execution_settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL);`)
  }
  accounts(): ImageAccountRecord[] {
    return this.database.prepare('SELECT * FROM image_accounts').all().map((row) => ({
      account: imageAccountSchema.parse(JSON.parse(String(row.data))), cipher: new Uint8Array(row.cipher as Uint8Array), fingerprint: String(row.fingerprint)
    }))
  }
  saveAccount(record: ImageAccountRecord, expectedRevision: number): void {
    const current = this.database.prepare('SELECT revision FROM image_accounts WHERE id = ?').get(record.account.id)
    if (current ? current.revision !== expectedRevision : expectedRevision !== 0) throw new Error('账号已更新，请重新打开')
    this.database.prepare(`INSERT INTO image_accounts VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      revision=excluded.revision, data=excluded.data, cipher=excluded.cipher, fingerprint=excluded.fingerprint`)
      .run(record.account.id, record.account.revision, JSON.stringify(record.account), record.cipher, record.fingerprint)
  }
  boards(projectId: string | null): ImageBoard[] {
    return this.database.prepare(`SELECT data FROM image_boards b WHERE project_id IS ? AND NOT EXISTS
      (SELECT 1 FROM workspace_trash t WHERE t.id = b.project_id) ORDER BY rowid DESC`).all(projectId)
      .map((row) => imageBoardSchema.parse(JSON.parse(String(row.data))))
  }
  board(id: string): ImageBoard {
    const row = this.database.prepare(`SELECT data FROM image_boards b WHERE id = ? AND NOT EXISTS
      (SELECT 1 FROM workspace_trash t WHERE t.id = b.project_id)`).get(id)
    if (!row) throw new Error('画布不存在或所属项目已删除')
    return imageBoardSchema.parse(JSON.parse(String(row.data)))
  }
  saveBoard(board: ImageBoard, expectedRevision: number): void {
    if (board.projectId && !this.database.prepare(`SELECT 1 FROM projects p WHERE id = ? AND NOT EXISTS
      (SELECT 1 FROM workspace_trash t WHERE t.id = p.id)`).get(board.projectId)) throw new Error('所属项目不存在或已删除')
    const current = this.database.prepare('SELECT revision FROM image_boards WHERE id = ?').get(board.id)
    if (current ? current.revision !== expectedRevision : expectedRevision !== 0) throw new Error('画布已更新，请重新打开')
    this.database.prepare(`INSERT INTO image_boards VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data`)
      .run(board.id, board.projectId, board.revision, JSON.stringify(board))
  }
  nodes(boardId?: string): ImageNode[] {
    return (boardId ? this.database.prepare('SELECT data FROM image_nodes WHERE board_id = ?').all(boardId)
      : this.database.prepare('SELECT data FROM image_nodes').all()).map((row) => imageNodeSchema.parse(JSON.parse(String(row.data))))
  }
  node(id: string): ImageNode {
    const row = this.database.prepare('SELECT data FROM image_nodes WHERE id = ?').get(id)
    if (!row) throw new Error('图片任务不存在')
    return imageNodeSchema.parse(JSON.parse(String(row.data)))
  }
  saveNodes(nodes: ImageNode[], expectedRevisions: number[], submission?: ImageSubmissionReceipt): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      nodes.forEach((node, index) => {
        this.board(node.boardId)
        const current = this.database.prepare('SELECT revision FROM image_nodes WHERE id = ?').get(node.id)
        if (current ? current.revision !== expectedRevisions[index] : expectedRevisions[index] !== 0) throw new Error('任务已更新，请刷新后重新操作')
        this.database.prepare(`INSERT INTO image_nodes VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data`)
          .run(node.id, node.boardId, node.revision, JSON.stringify(node))
        // 提交后的源图引用和结果引用不随画布布局变更丢失。
        this.database.prepare('DELETE FROM image_node_refs WHERE node_id = ?').run(node.id)
        for (const assetId of [...node.references.map((ref) => ref.assetId), ...(node.assetId ? [node.assetId] : [])]) {
          this.database.prepare('INSERT OR IGNORE INTO image_node_refs VALUES (?, ?)').run(node.id, assetId)
        }
      })
      // 请求回执与整批入队共用事务，重启或 MCP 断线不能把一次提交变成两次生成。
      if (submission) this.database.prepare('INSERT INTO image_submission_requests VALUES (?, ?, ?, ?)')
        .run(submission.requestKey, submission.input, JSON.stringify(submission.nodeIds), submission.createdAt)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  references(assetId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM image_node_refs WHERE asset_id = ? LIMIT 1').get(assetId))
  }
  submission(requestKey: string): ImageSubmissionReceipt | null {
    const row = this.database.prepare('SELECT * FROM image_submission_requests WHERE request_key = ?').get(requestKey)
    return row ? { requestKey: String(row.request_key), input: String(row.input), nodeIds: z.array(z.string().uuid()).parse(JSON.parse(String(row.node_ids))), createdAt: String(row.created_at) } : null
  }
  output(id: string): Uint8Array | null {
    const row = this.database.prepare('SELECT cipher FROM image_outputs WHERE node_id = ?').get(id)
    return row ? new Uint8Array(row.cipher as Uint8Array) : null
  }
  saveOutput(id: string, cipher: Uint8Array): void {
    this.database.prepare('INSERT INTO image_outputs VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET cipher=excluded.cipher').run(id, cipher)
  }
  settings(): ImageExecutionSettings {
    const row = this.database.prepare('SELECT data FROM image_execution_settings WHERE singleton=1').get()
    return imageExecutionSettingsSchema.parse(row ? JSON.parse(String(row.data)) : { globalConcurrency: 2 })
  }
  saveSettings(settings: ImageExecutionSettings): void {
    this.database.prepare('INSERT INTO image_execution_settings VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data=excluded.data').run(JSON.stringify(settings))
  }
}
