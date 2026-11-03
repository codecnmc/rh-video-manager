import type { DatabaseSync } from 'node:sqlite'
import { assemblyDocumentSchema, type AssemblyDocument } from '../../../../shared/contracts/assembly'
import type { AssemblyRepository } from '../ports/assembly'

export class SqliteAssemblyRepository implements AssemblyRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS assembly_documents (
      id TEXT PRIMARY KEY, project_id TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assembly_project ON assembly_documents(project_id);
      CREATE TABLE IF NOT EXISTS assembly_history (
        document_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(document_id, revision));
      CREATE TABLE IF NOT EXISTS assembly_asset_refs (
        document_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(document_id, asset_id));
      CREATE INDEX IF NOT EXISTS assembly_asset ON assembly_asset_refs(asset_id);`)
  }
  list(projectId: string | null): AssemblyDocument[] {
    return this.database.prepare(`SELECT data FROM assembly_documents d WHERE project_id IS ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = d.project_id) ORDER BY rowid DESC`)
      .all(projectId).map((row) => assemblyDocumentSchema.parse(JSON.parse(String(row.data))))
  }
  references(assetId: string): boolean {
    // 历史修订同样保留引用，避免已保存的旧版本丢失源媒体。
    return Boolean(this.database.prepare('SELECT 1 FROM assembly_asset_refs WHERE asset_id = ? LIMIT 1').get(assetId))
  }
  save(document: AssemblyDocument, expectedRevision: number): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (document.projectId && !this.database.prepare(`SELECT 1 FROM projects p WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM workspace_trash t WHERE t.id = p.id)`).get(document.projectId)) throw new Error('所属项目不存在或已删除')
      const current = this.database.prepare('SELECT project_id, revision FROM assembly_documents WHERE id = ?').get(document.id)
      if (current ? current.revision !== expectedRevision || current.project_id !== document.projectId : expectedRevision !== 0) throw new Error('工程已被其他窗口更新，请重新打开后再编辑')
      const serialized = JSON.stringify(document)
      this.database.prepare(`INSERT INTO assembly_documents (id, project_id, revision, data) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data`).run(document.id, document.projectId, document.revision, serialized)
      this.database.prepare('INSERT INTO assembly_history VALUES (?, ?, ?)').run(document.id, document.revision, serialized)
      const add = this.database.prepare('INSERT OR IGNORE INTO assembly_asset_refs VALUES (?, ?)')
      for (const version of document.versions) {
        for (const id of [...version.clips.flatMap((clip) => clip.assetId ? [clip.assetId] : []), ...version.sounds.flatMap((sound) => sound.assetId ? [sound.assetId] : [])]) add.run(document.id, id)
      }
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
