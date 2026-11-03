import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateAssetFolderScopes } from '../src/main/infrastructure/database/asset-folder-migration.ts'

function legacyDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    INSERT INTO projects VALUES ('a'), ('b');
    CREATE TABLE asset_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, parent_id TEXT REFERENCES asset_categories(id));
    CREATE UNIQUE INDEX asset_folders_root_name ON asset_categories(name) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX asset_folders_sibling_name ON asset_categories(parent_id, name) WHERE parent_id IS NOT NULL;
    CREATE TABLE assets (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), category_id TEXT REFERENCES asset_categories(id),
      data TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
    CREATE TABLE video_drafts (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id));
    CREATE TABLE draft_asset_folders (draft_id TEXT PRIMARY KEY REFERENCES video_drafts(id), category_id TEXT NOT NULL UNIQUE REFERENCES asset_categories(id));
    PRAGMA user_version = 12;`)
  return db
}

test('旧共享目录按素材和草稿归属拆分，保留层级、归档、软删除及受管文件引用', () => {
  const db = legacyDatabase()
  try {
    db.exec(`INSERT INTO asset_categories VALUES ('root', '角色', NULL), ('child', '医生', 'root'), ('empty', '空目录', NULL);
      INSERT INTO video_drafts VALUES ('draft', 'b');
      INSERT INTO draft_asset_folders VALUES ('draft', 'child');`)
    for (const [id, projectId, archived, deletedAt] of [
      ['first', 'a', 0, null], ['second', 'b', 1, null], ['deleted', 'b', 0, '2026-10-21'], ['public', null, 0, null]
    ] as const) db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, 'child', JSON.stringify({ id, categoryId: 'child', storedName: `${id}.png` }), archived, deletedAt)
    migrateAssetFolderScopes(db)
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 13)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const rows = db.prepare(`SELECT a.*, c.project_id AS folder_project, c.parent_id, p.project_id AS parent_project
      FROM assets a JOIN asset_categories c ON c.id = a.category_id JOIN asset_categories p ON p.id = c.parent_id`).all()
    assert.equal(rows.length, 4)
    for (const row of rows) {
      assert.equal(row.project_id, row.folder_project)
      assert.equal(row.project_id, row.parent_project)
      const data = JSON.parse(String(row.data)) as { categoryId: string; storedName: string }
      assert.equal(data.categoryId, row.category_id)
      assert.equal(data.storedName, `${String(row.id)}.png`)
    }
    const second = rows.find((row) => row.id === 'second')!
    assert.equal(second.archived, 1)
    assert.equal(rows.find((row) => row.id === 'deleted')?.deleted_at, '2026-10-21')
    assert.equal(db.prepare('SELECT category_id FROM draft_asset_folders').get()?.category_id, second.category_id)
    assert.equal(db.prepare("SELECT project_id FROM asset_categories WHERE id = 'empty'").get()?.project_id, null)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM asset_categories WHERE name = '角色'").get()?.count, 3)
  } finally { db.close() }
})

test('只有草稿绑定的空目录归属草稿项目，迁移异常整体回滚', () => {
  const db = legacyDatabase()
  try {
    db.exec(`INSERT INTO asset_categories VALUES ('root', '草稿目录', NULL);
      INSERT INTO video_drafts VALUES ('draft', 'b');
      INSERT INTO draft_asset_folders VALUES ('draft', 'root');`)
    migrateAssetFolderScopes(db)
    assert.equal(db.prepare("SELECT project_id FROM asset_categories WHERE id = 'root'").get()?.project_id, 'b')
  } finally { db.close() }
  const invalid = legacyDatabase()
  try {
    invalid.exec("INSERT INTO asset_categories VALUES ('root', '循环', NULL); UPDATE asset_categories SET parent_id = 'root'")
    assert.throws(() => migrateAssetFolderScopes(invalid), /循环/)
    assert.equal(invalid.prepare('PRAGMA user_version').get()?.user_version, 12)
    assert.equal(invalid.prepare('PRAGMA table_info(asset_categories)').all().some((row) => row.name === 'project_id'), false)
  } finally { invalid.close() }
})
