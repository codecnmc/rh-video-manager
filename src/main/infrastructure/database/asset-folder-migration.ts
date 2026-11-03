import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export function migrateAssetFolderScopes(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`ALTER TABLE asset_categories ADD COLUMN project_id TEXT REFERENCES projects(id);
      DROP INDEX asset_folders_root_name;
      DROP INDEX asset_folders_sibling_name;`)
    const folders = database.prepare('SELECT id, name, parent_id FROM asset_categories').all().map((row) => ({
      id: String(row.id), name: String(row.name), parentId: row.parent_id === null ? null : String(row.parent_id)
    }))
    const assets = folders.length ? database.prepare('SELECT id, category_id, project_id FROM assets WHERE category_id IS NOT NULL').all() : []
    const drafts = folders.length ? database.prepare(`SELECT f.draft_id, f.category_id, d.project_id FROM draft_asset_folders f
      JOIN video_drafts d ON d.id = f.draft_id`).all() : []
    const rootOf = (id: string): string => {
      const visited = new Set<string>()
      let current = id
      while (true) {
        if (visited.has(current)) throw new Error('历史文件夹存在循环，无法迁移')
        visited.add(current)
        const folder = folders.find((item) => item.id === current)
        if (!folder) throw new Error('历史文件夹父目录缺失，无法迁移')
        if (!folder.parentId) return current
        current = folder.parentId
      }
    }
    // 同一棵旧目录可能被多个项目使用；按真实素材及草稿归属复制目录，不复制媒体文件。
    const roots = new Map(folders.map((folder) => [folder.id, rootOf(folder.id)]))
    for (const root of folders.filter((folder) => folder.parentId === null)) {
      const tree = folders.filter((folder) => roots.get(folder.id) === root.id)
      const ids = new Set(tree.map((folder) => folder.id))
      const references = [...assets, ...drafts].filter((row) => ids.has(String(row.category_id)))
      const scopes = [...new Set(references.map((row) => row.project_id === null ? null : String(row.project_id)))]
      if (!scopes.length) scopes.push(null)
      for (const [index, projectId] of scopes.entries()) {
        const mapping = new Map(tree.map((folder) => [folder.id, index === 0 ? folder.id : randomUUID()]))
        if (index === 0) {
          for (const folder of tree) database.prepare('UPDATE asset_categories SET project_id = ? WHERE id = ?').run(projectId, folder.id)
        } else {
          // 先创建目录再设置父指针，避免依赖原始行顺序或暂时违反外键。
          for (const folder of tree) database.prepare('INSERT INTO asset_categories (id, name, project_id) VALUES (?, ?, ?)')
            .run(mapping.get(folder.id)!, folder.name, projectId)
          for (const folder of tree) if (folder.parentId) database.prepare('UPDATE asset_categories SET parent_id = ? WHERE id = ?')
            .run(mapping.get(folder.parentId)!, mapping.get(folder.id)!)
        }
        for (const asset of assets.filter((row) => ids.has(String(row.category_id)) && row.project_id === projectId)) {
          const categoryId = mapping.get(String(asset.category_id))!
          if (categoryId === asset.category_id) continue
          database.prepare("UPDATE assets SET category_id = ?, data = json_set(data, '$.categoryId', ?) WHERE id = ?")
            .run(categoryId, categoryId, String(asset.id))
        }
        for (const draft of drafts.filter((row) => ids.has(String(row.category_id)) && row.project_id === projectId)) {
          database.prepare('UPDATE draft_asset_folders SET category_id = ? WHERE draft_id = ?')
            .run(mapping.get(String(draft.category_id))!, String(draft.draft_id))
        }
      }
    }
    database.exec(`CREATE UNIQUE INDEX asset_folders_root_name ON asset_categories(IFNULL(project_id, ''), name) WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX asset_folders_sibling_name ON asset_categories(IFNULL(project_id, ''), parent_id, name) WHERE parent_id IS NOT NULL;
      PRAGMA user_version = 13; COMMIT`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}
