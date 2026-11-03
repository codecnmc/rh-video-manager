import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateWorkbench, workbenchSchemaVersion } from '../src/main/infrastructure/database/migrations.ts'
import { createWorkspace } from '../src/main/bootstrap/create-workspace.ts'

function oldDatabase(edited: boolean) {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE workspace_meta (singleton INTEGER PRIMARY KEY, revision INTEGER, updated_at TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, sample INTEGER, sort_order INTEGER);
    CREATE TABLE episodes (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, title TEXT, script TEXT, sort_order INTEGER);
    CREATE TABLE shots (id TEXT PRIMARY KEY, episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE, title TEXT, description TEXT,
      prompt TEXT, duration INTEGER, aspect_ratio TEXT, resolution TEXT, instance TEXT, sort_order INTEGER);
    INSERT INTO workspace_meta VALUES (1, 1, '2026-10-19');
    INSERT INTO projects VALUES ('project', '图书馆的午后', 1, 0);
    INSERT INTO episodes VALUES ('episode', 'project', '第01集 · 重逢', '', 0);`)
  const titles = ['午后的图书馆', '未说出口的话', '窗边的约定', '一张旧书签', '放学之后']
  const description = '午后的阳光穿过图书馆窗户。女孩坐在桌边读书，男孩轻轻放下手中的书，望向她。镜头缓慢推进，保留书架与窗边的空间关系。'
  const insert = db.prepare('INSERT INTO shots VALUES (?, ?, ?, ?, ?, 8, ?, ?, ?, ?)')
  titles.forEach((title, index) => insert.run(`shot-${index}`, 'episode', title, index === 0 ? description : '', edited && index === 0 ? '用户编辑' : '', '16:9', '720P', 'default', index))
  return db
}

test('首次项目快照不包含示例业务数据', () => {
  assert.deepEqual(createWorkspace().projects, [])
})

test('v8 分类迁移为一级文件夹，保留素材外键和元数据，重复启动不改变目录', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE asset_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE assets (id TEXT PRIMARY KEY, category_id TEXT REFERENCES asset_categories(id), data TEXT NOT NULL, project_id TEXT);
      CREATE TABLE video_drafts (id TEXT PRIMARY KEY, project_id TEXT);
      INSERT INTO asset_categories VALUES ('old', '旧分类');
      INSERT INTO assets VALUES ('asset', 'old', '原始元数据', NULL);
      PRAGMA user_version = 8;`)
    migrateWorkbench(db, 8)
    assert.equal(db.prepare('SELECT parent_id FROM asset_categories WHERE id = ?').get('old')?.parent_id, null)
    assert.equal(db.prepare('SELECT category_id, data FROM assets').get()?.category_id, 'old')
    assert.equal(db.prepare('SELECT data FROM assets').get()?.data, '原始元数据')
    db.exec("INSERT INTO asset_categories (id, name, parent_id) VALUES ('child', '旧分类', 'old')")
    assert.throws(() => db.exec("INSERT INTO asset_categories (id, name, parent_id) VALUES ('duplicate', '旧分类', 'old')"), /UNIQUE/)
    assert.throws(() => db.exec("INSERT INTO asset_categories (id, name, parent_id) VALUES ('duplicate-root', '旧分类', NULL)"), /UNIQUE/)
    assert.throws(() => db.exec("DELETE FROM asset_categories WHERE id = 'old'"), /FOREIGN KEY/)
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    migrateWorkbench(db, workbenchSchemaVersion)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM asset_categories').get()?.count, 2)
  } finally { db.close() }
})

test('v7 引用表升级保留全部行和顺序，仅有效关联占用编号，重复升级不改数据', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE video_drafts (id TEXT PRIMARY KEY);
      CREATE TABLE assets (id TEXT PRIMARY KEY);
      CREATE TABLE draft_references (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES video_drafts(id),
        asset_id TEXT NOT NULL REFERENCES assets(id), kind TEXT NOT NULL, label TEXT NOT NULL,
        ordinal INTEGER NOT NULL, removed_at TEXT, UNIQUE(draft_id, label), UNIQUE(draft_id, kind, ordinal)
      );
      INSERT INTO video_drafts VALUES ('draft');
      INSERT INTO assets VALUES ('old-asset'), ('active-asset'), ('new-asset');
      INSERT INTO draft_references VALUES ('old', 'draft', 'old-asset', 'image', '<Picture 1>', 1, '2026-10-19T00:00:00.000Z');
      INSERT INTO draft_references VALUES ('active', 'draft', 'active-asset', 'image', '<Picture 3>', 3, NULL);
      PRAGMA user_version = 7;`)
    const before = db.prepare('SELECT rowid, * FROM draft_references ORDER BY rowid').all()
    migrateWorkbench(db, 7)
    assert.deepEqual(db.prepare('SELECT rowid, * FROM draft_references ORDER BY rowid').all(), before)
    const insert = db.prepare('INSERT INTO draft_references VALUES (?, ?, ?, ?, ?, ?, NULL)')
    insert.run('new', 'draft', 'new-asset', 'image', '<Picture 1>', 1)
    assert.throws(() => insert.run('duplicate-label', 'draft', 'new-asset', 'image', '<Picture 1>', 2), /UNIQUE/)
    assert.throws(() => insert.run('duplicate-ordinal', 'draft', 'new-asset', 'image', '<Picture 2>', 1), /UNIQUE/)
    assert.throws(() => insert.run('missing-asset', 'draft', 'missing', 'image', '<Picture 2>', 2), /FOREIGN KEY/)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const after = db.prepare('SELECT rowid, * FROM draft_references ORDER BY rowid').all()
    migrateWorkbench(db, workbenchSchemaVersion)
    assert.deepEqual(db.prepare('SELECT rowid, * FROM draft_references ORDER BY rowid').all(), after)
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, workbenchSchemaVersion)
  } finally { db.close() }
})

test('迁移只清除完全未编辑的旧自动示例', () => {
  for (const edited of [false, true]) {
    const db = oldDatabase(edited)
    try {
      migrateWorkbench(db, 1)
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count, edited ? 1 : 0)
      assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, workbenchSchemaVersion)
      if (edited) {
        assert.equal(db.prepare('SELECT sample FROM projects').get()?.sample, 0)
        assert.equal(db.prepare("SELECT prompt, prompt_document FROM shots WHERE id = 'shot-0'").get()?.prompt, '用户编辑')
        assert.equal(db.prepare("SELECT prompt_document FROM shots WHERE id = 'shot-0'").get()?.prompt_document, '')
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_drafts').get()?.count, 5)
        const video = db.prepare("SELECT data FROM video_drafts WHERE id = 'shot-0'").get()
        assert.equal(JSON.parse(String(video?.data)).prompt, '用户编辑')
      }
    } finally { db.close() }
  }
})

test('旧 v4 缺少软删除结构时升级到当前版本，不覆盖现有业务数据', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE video_drafts (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE assets (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), data TEXT NOT NULL);
      INSERT INTO projects VALUES ('project', '已有项目');
      INSERT INTO video_drafts VALUES ('draft', 'project', '原有视频草稿');
      INSERT INTO assets VALUES ('asset', 'project', '原有素材元数据');
      PRAGMA user_version = 4;`)
    migrateWorkbench(db, 4)
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, workbenchSchemaVersion)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workspace_trash').get()?.count, 0)
    assert.equal(db.prepare('SELECT name FROM projects').get()?.name, '已有项目')
    assert.equal(db.prepare('SELECT data FROM video_drafts').get()?.data, '原有视频草稿')
    assert.equal(db.prepare('SELECT data, deleted_at FROM assets').get()?.data, '原有素材元数据')
    assert.equal(db.prepare('SELECT deleted_at FROM assets').get()?.deleted_at, null)
    // 升级完成后再次启动不重复加列或修改数据。
    migrateWorkbench(db, workbenchSchemaVersion)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get()?.count, 1)
  } finally { db.close() }
})

test('v4 已有部分或全部软删除结构时仍能升级，保留墓碑与删除标记', () => {
  for (const hasTrash of [false, true]) {
    for (const hasDeletedAt of [false, true]) {
      const db = new DatabaseSync(':memory:')
      try {
        db.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, data TEXT NOT NULL${hasDeletedAt ? ', deleted_at TEXT' : ''});
          INSERT INTO assets (id, data) VALUES ('asset', '原有数据');
          PRAGMA user_version = 4;`)
        if (hasDeletedAt) db.exec("UPDATE assets SET deleted_at = '2026-10-19T00:00:00.000Z'")
        if (hasTrash) {
          db.exec(`CREATE TABLE workspace_trash (id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT NOT NULL, snapshot TEXT NOT NULL, deleted_at TEXT NOT NULL);
            INSERT INTO workspace_trash VALUES ('draft', 'video', 'project', '原有删除快照', '2026-10-19T00:00:00.000Z');`)
        }
        migrateWorkbench(db, 4)
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, workbenchSchemaVersion)
        assert.equal(db.prepare('SELECT data FROM assets').get()?.data, '原有数据')
        assert.equal(db.prepare('SELECT deleted_at FROM assets').get()?.deleted_at, hasDeletedAt ? '2026-10-19T00:00:00.000Z' : null)
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workspace_trash').get()?.count, hasTrash ? 1 : 0)
        if (hasTrash) assert.equal(db.prepare('SELECT snapshot FROM workspace_trash').get()?.snapshot, '原有删除快照')
      } finally { db.close() }
    }
  }
})
