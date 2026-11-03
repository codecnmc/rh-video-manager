import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrateAssetFolderScopes } from './asset-folder-migration'

export const workbenchSchemaVersion = 16

export function migrateWorkbench(database: DatabaseSync, version: number): void {
  if (version < 2) migrateVersionTwo(database)
  if (version < 3) migrateVersionThree(database)
  if (version < 4) migrateVersionFour(database)
  if (version < 5) migrateVersionFive(database)
  if (version < 6) migrateVersionSix(database)
  if (version < 7) migrateVersionSeven(database)
  if (version < 8) migrateVersionEight(database)
  if (version < 9) migrateVersionNine(database)
  if (version < 10) migrateVersionTen(database)
  if (version < 11) migrateVersionEleven(database)
  if (version < 12) migrateVersionTwelve(database)
  if (version < 13) migrateAssetFolderScopes(database)
  if (version < 14) migrateVersionFourteen(database)
  if (version < 15) migrateVersionFifteen(database)
  if (version < 16) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec("ALTER TABLE projects ADD COLUMN video_groups TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 16;")
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }
}

function migrateVersionFifteen(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    // 用户指定旧剧本归入测试项目；不根据正文推断其他归属。
    database.exec(`ALTER TABLE script_library ADD COLUMN project_id TEXT REFERENCES projects(id);
      CREATE INDEX script_library_project ON script_library(project_id, updated_at) WHERE deleted_at IS NULL;`)
    if (database.prepare('SELECT 1 FROM script_library LIMIT 1').get()) {
      const projects = database.prepare(`SELECT id FROM projects WHERE name = '测试项目'
        AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE id = projects.id) ORDER BY sort_order, id`).all()
      if (projects.length > 1) throw new Error('存在多个同名测试项目，请先重命名为唯一名称再迁移剧本')
      const projectId = projects[0] ? String(projects[0].id) : randomUUID()
      if (!projects.length) database.prepare(`INSERT INTO projects (id, name, sample, sort_order)
        VALUES (?, '测试项目', 0, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects))`).run(projectId)
      database.prepare('UPDATE script_library SET project_id = ?').run(projectId)
    }
    database.exec('PRAGMA user_version = 15; COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionFourteen(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`CREATE TABLE media_storage_settings (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), data TEXT NOT NULL);
      PRAGMA user_version = 14; COMMIT`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionTwelve(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`CREATE TABLE asset_mcp_preferences (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), data TEXT NOT NULL);
      PRAGMA user_version = 12; COMMIT`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionEleven(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`CREATE TABLE script_library (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE app_preferences (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), data TEXT NOT NULL);
    PRAGMA user_version = 11; COMMIT`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionTen(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, snapshot TEXT NOT NULL
    );
    CREATE TABLE generation_job_assets (
      job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      asset_id TEXT NOT NULL REFERENCES assets(id), PRIMARY KEY(job_id, asset_id)
    );
    PRAGMA user_version = 10; COMMIT`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionNine(database: DatabaseSync): void {
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1
  // 重建分类表以移除全局名称唯一约束；既有素材外键和分类 ID 保持不变。
  database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
  try {
    const existing = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_categories'").get()
    database.exec(`CREATE TABLE asset_categories_v9 (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE,
      parent_id TEXT REFERENCES asset_categories(id), CHECK(parent_id IS NULL OR parent_id <> id)
    )`)
    if (existing) {
      database.exec(`INSERT INTO asset_categories_v9 (id, name, parent_id) SELECT id, name, NULL FROM asset_categories;
        DROP TABLE asset_categories;`)
    }
    database.exec(`ALTER TABLE asset_categories_v9 RENAME TO asset_categories;
      CREATE UNIQUE INDEX asset_folders_root_name ON asset_categories(name) WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX asset_folders_sibling_name ON asset_categories(parent_id, name) WHERE parent_id IS NOT NULL;
      CREATE TABLE draft_asset_folders (
        draft_id TEXT PRIMARY KEY REFERENCES video_drafts(id),
        category_id TEXT NOT NULL UNIQUE REFERENCES asset_categories(id) ON DELETE CASCADE
      );`)
    // 仅检查本次重建表及其既有素材引用，不让无关历史表阻断目录迁移。
    const assetsExist = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assets'").get()
    if (database.prepare('PRAGMA foreign_key_check(asset_categories)').all().length ||
      (assetsExist && database.prepare('PRAGMA foreign_key_check(assets)').all().length)) throw new Error('素材文件夹迁移外键检查失败')
    database.exec('PRAGMA user_version = 9; COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  finally { database.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`) }
}

function migrateVersionEight(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`CREATE TABLE draft_references_v8 (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES video_drafts(id),
      asset_id TEXT NOT NULL REFERENCES assets(id), kind TEXT NOT NULL, label TEXT NOT NULL,
      ordinal INTEGER NOT NULL, removed_at TEXT
    )`)
    const existing = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'draft_references'").get()
    if (existing) {
      // SQLite 内联唯一约束需重建表才能替换，逐行保留历史、关联 ID 和原展示顺序。
      database.exec(`INSERT INTO draft_references_v8 (rowid, id, draft_id, asset_id, kind, label, ordinal, removed_at)
        SELECT rowid, id, draft_id, asset_id, kind, label, ordinal, removed_at FROM draft_references;
        DROP TABLE draft_references;`)
    }
    database.exec(`ALTER TABLE draft_references_v8 RENAME TO draft_references;
      CREATE UNIQUE INDEX draft_references_active_label ON draft_references(draft_id, label) WHERE removed_at IS NULL;
      CREATE UNIQUE INDEX draft_references_active_ordinal ON draft_references(draft_id, kind, ordinal) WHERE removed_at IS NULL;
      PRAGMA user_version = 8;
      COMMIT;`)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionSeven(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE dialogue_plans (
        draft_id TEXT PRIMARY KEY REFERENCES video_drafts(id), project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL
      );
      CREATE TABLE dialogue_takes (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES video_drafts(id), project_id TEXT NOT NULL REFERENCES projects(id),
        asset_id TEXT REFERENCES assets(id), data TEXT NOT NULL
      );
      CREATE INDEX dialogue_takes_scope ON dialogue_takes(project_id, draft_id);
      CREATE TABLE production_defaults (project_id TEXT PRIMARY KEY REFERENCES projects(id), data TEXT NOT NULL);
      PRAGMA user_version = 7;
      COMMIT;
    `)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionSix(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE extensions (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, installed INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE extension_secrets (
        extension_id TEXT NOT NULL REFERENCES extensions(id), key TEXT NOT NULL, cipher BLOB NOT NULL,
        PRIMARY KEY(extension_id, key)
      );
      PRAGMA user_version = 6;
      COMMIT;
    `)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionFive(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    // 开发期间存在两种 v4 结构，独立升级补齐软删除，不能重跑含数据复制的 v4。
    database.exec(`CREATE TABLE IF NOT EXISTS workspace_trash (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT NOT NULL,
      snapshot TEXT NOT NULL, deleted_at TEXT NOT NULL
    )`)
    const columns = database.prepare('PRAGMA table_info(assets)').all()
    if (!columns.some((column) => column.name === 'deleted_at')) {
      database.exec('ALTER TABLE assets ADD COLUMN deleted_at TEXT')
    }
    database.exec('PRAGMA user_version = 5; COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionFour(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE video_drafts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        sort_order INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE asset_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), category_id TEXT REFERENCES asset_categories(id),
        kind TEXT NOT NULL, stored_name TEXT, data TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT
      );
      CREATE TABLE workspace_trash (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT NOT NULL,
        snapshot TEXT NOT NULL, deleted_at TEXT NOT NULL
      );
      CREATE TABLE draft_references (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES video_drafts(id),
        asset_id TEXT NOT NULL REFERENCES assets(id), kind TEXT NOT NULL, label TEXT NOT NULL,
        ordinal INTEGER NOT NULL, removed_at TEXT, UNIQUE(draft_id, label), UNIQUE(draft_id, kind, ordinal)
      );
      CREATE INDEX assets_project_category ON assets(project_id, category_id, archived);
    `)
    // 保留原分镜表作存档，同 ID 转成项目级视频草稿以保留提示词与引用关系。
    const oldShots = database.prepare(`SELECT shots.*, episodes.project_id FROM shots
      JOIN episodes ON episodes.id = shots.episode_id ORDER BY episodes.sort_order, shots.sort_order`).all()
    const order = new Map<string, number>()
    for (const row of oldShots) {
      const projectId = String(row.project_id)
      const index = order.get(projectId) ?? 0
      database.prepare('INSERT INTO video_drafts VALUES (?, ?, ?, ?)').run(String(row.id), projectId, index, JSON.stringify({
        id: row.id, title: row.title, description: row.description, prompt: row.prompt, promptDocument: row.prompt_document,
        duration: row.duration, aspectRatio: row.aspect_ratio, resolution: row.resolution, instance: row.instance
      }))
      order.set(projectId, index + 1)
    }
    const oldReferences = database.prepare(`SELECT r.*, e.project_id FROM shot_references r
      JOIN shots s ON s.id = r.shot_id JOIN episodes e ON e.id = s.episode_id`).all()
    const now = new Date().toISOString()
    for (const row of oldReferences) {
      database.prepare('INSERT INTO assets (id, project_id, category_id, kind, stored_name, data) VALUES (?, ?, NULL, ?, ?, ?)')
        .run(String(row.id), String(row.project_id), String(row.kind), String(row.stored_name), JSON.stringify({
          id: row.id, projectId: row.project_id, categoryId: null, kind: row.kind, name: row.name,
          size: row.size, tags: [], prompt: '', notes: '', createdAt: now, updatedAt: now, archived: false
        }))
      database.prepare('INSERT INTO draft_references VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(String(row.id), String(row.shot_id), String(row.id), String(row.kind), String(row.label), Number(row.ordinal), row.removed_at ?? null)
    }
    database.exec('UPDATE workspace_meta SET revision = revision + 1; PRAGMA user_version = 4; COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionTwo(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      ALTER TABLE shots ADD COLUMN prompt_document TEXT NOT NULL DEFAULT '';
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, key_fingerprint TEXT NOT NULL UNIQUE,
        key_cipher BLOB NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE, is_default INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX workflows_one_default ON workflows(is_default) WHERE is_default = 1;
      CREATE TABLE shot_references (
        id TEXT PRIMARY KEY, shot_id TEXT NOT NULL REFERENCES shots(id), kind TEXT NOT NULL,
        label TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, stored_name TEXT NOT NULL,
        ordinal INTEGER NOT NULL, removed_at TEXT, UNIQUE(shot_id, label), UNIQUE(shot_id, kind, ordinal)
      );
    `)
    removeUntouchedExample(database)
    database.exec('PRAGMA user_version = 2; COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function migrateVersionThree(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    // 旧的全局配置保留为未分配状态，不猜测其所属账户或继续用错 Key。
    database.exec(`
      CREATE TABLE workflows_scoped (
        id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id), workflow_id TEXT NOT NULL,
        is_default INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(account_id, workflow_id)
      );
      INSERT INTO workflows_scoped (id, account_id, workflow_id, is_default, data)
        SELECT id, NULL, workflow_id, 0, data FROM workflows;
      DROP TABLE workflows;
      ALTER TABLE workflows_scoped RENAME TO workflows;
      CREATE UNIQUE INDEX workflows_one_account_default ON workflows(account_id)
        WHERE is_default = 1 AND account_id IS NOT NULL;
      PRAGMA user_version = 3;
      COMMIT;
    `)
  } catch (error) { database.exec('ROLLBACK'); throw error }
}

function removeUntouchedExample(database: DatabaseSync): void {
  const titles = ['午后的图书馆', '未说出口的话', '窗边的约定', '一张旧书签', '放学之后']
  const description = '午后的阳光穿过图书馆窗户。女孩坐在桌边读书，男孩轻轻放下手中的书，望向她。镜头缓慢推进，保留书架与窗边的空间关系。'
  const candidates = database.prepare("SELECT id FROM projects WHERE sample = 1 AND name = '图书馆的午后'").all()
  for (const candidate of candidates) {
    const episodes = database.prepare('SELECT id, title, script FROM episodes WHERE project_id = ?').all(candidate.id ?? '')
    const episode = episodes[0]
    if (episodes.length !== 1 || !episode || episode.title !== '第01集 · 重逢' || episode.script !== '') continue
    const shots = database.prepare('SELECT * FROM shots WHERE episode_id = ? ORDER BY sort_order').all(episode.id ?? '')
    const untouched = shots.length === titles.length && shots.every((shot, index) => shot.title === titles[index] &&
      shot.description === (index === 0 ? description : '') && shot.prompt === '' && shot.duration === 8 &&
      shot.aspect_ratio === '16:9' && shot.resolution === '720P' && shot.instance === 'default')
    // 仅移除完全未编辑的旧自动示例；任何修改都按用户数据保留。
    if (untouched) database.prepare('DELETE FROM projects WHERE id = ?').run(candidate.id ?? '')
  }
  database.exec("UPDATE projects SET sample = 0 WHERE sample = 1; UPDATE workspace_meta SET revision = revision + 1")
}
