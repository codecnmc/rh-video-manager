import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { migrateWorkbench } from '../src/main/infrastructure/database/migrations.ts'
import { SqliteProjectRepository } from '../src/main/infrastructure/database/project-repository.ts'
import { SqliteScriptLibraryRepository } from '../src/main/infrastructure/database/script-library-repository.ts'
import { ScriptLibraryService } from '../src/main/modules/scripts/application/script-library-service.ts'

test('剧本按项目隔离，同名文档不串库，错误项目不能修改或删除', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const projects = new SqliteProjectRepository(database.connection)
    const a = randomUUID(), b = randomUUID()
    projects.upsert({ id: a, name: '甲', sample: false }, 0)
    projects.upsert({ id: b, name: '乙', sample: false }, 1)
    const library = new ScriptLibraryService(new SqliteScriptLibraryRepository(database.connection), randomUUID)
    const first = library.save({ id: randomUUID(), projectId: a, title: '剧情稿', markdown: '甲正文', expectedRevision: null })
    library.save({ id: randomUUID(), projectId: b, title: '剧情稿', markdown: '乙正文', expectedRevision: null })
    assert.equal(library.list(a)[0]?.markdown, '甲正文')
    assert.equal(library.list(b)[0]?.markdown, '乙正文')
    assert.deepEqual(library.list(null), [])
    assert.throws(() => library.save({ ...first, projectId: b, markdown: '越权', expectedRevision: first.revision }), /变更或删除/)
    assert.throws(() => library.remove({ id: first.id, projectId: b, expectedRevision: first.revision }), /变更或删除/)
    assert.throws(() => library.save({ ...first, projectId: randomUUID(), expectedRevision: null }), /项目不存在/)
    const loose = library.save({ id: randomUUID(), title: '未归属', markdown: '保留', expectedRevision: null })
    const assigned = library.assign({ id: loose.id, projectId: a, expectedRevision: loose.revision })
    assert.equal(assigned.revision, loose.revision + 1)
    assert.deepEqual(library.list(null), [])
    assert.throws(() => library.assign({ id: loose.id, projectId: b, expectedRevision: assigned.revision }), /已归属/)
    assert.equal(library.get(first.id).markdown, '甲正文')
    database.connection.prepare('INSERT INTO workspace_trash (id, kind, project_id, snapshot, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(a, 'project', a, '{}', '2026-10-21')
    assert.deepEqual(library.list(a), [])
    assert.throws(() => library.get(first.id), /不存在或已删除/)
    assert.throws(() => library.save({ ...first, expectedRevision: first.revision }), /项目不存在或已删除/)
    assert.equal(database.connection.prepare('SELECT markdown FROM script_library WHERE id = ?').get(first.id)?.markdown, '甲正文')
  } finally { database.close() }
})

for (const existingProject of [false, true]) test(`旧剧本迁入${existingProject ? '已有' : '新建'}测试项目并保留删除状态及修订`, () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const db = database.connection
    const projectId = randomUUID()
    if (existingProject) new SqliteProjectRepository(db).upsert({ id: projectId, name: '测试项目', sample: false }, 0)
    db.exec('DROP INDEX script_library_project; ALTER TABLE script_library DROP COLUMN project_id; PRAGMA user_version = 14')
    const id = randomUUID(), deletedId = randomUUID()
    db.prepare('INSERT INTO script_library (id, title, markdown, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, '剧情稿', '# 原文', 8, '2026-10-20', null)
    db.prepare('INSERT INTO script_library (id, title, markdown, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(deletedId, '已删除', '历史', 4, '2026-10-19', '2026-10-20')
    migrateWorkbench(db, 14)
    const target = db.prepare("SELECT id FROM projects WHERE name = '测试项目'").get()!
    if (existingProject) assert.equal(target.id, projectId)
    const library = new ScriptLibraryService(new SqliteScriptLibraryRepository(db), randomUUID)
    assert.deepEqual(library.list(null), [])
    assert.equal(library.list(String(target.id))[0]?.id, id)
    assert.equal(library.list(String(target.id))[0]?.revision, 8)
    assert.equal(library.list(String(target.id))[0]?.markdown, '# 原文')
    assert.equal(db.prepare('SELECT deleted_at FROM script_library WHERE id = ?').get(deletedId)?.deleted_at, '2026-10-20')
    assert.equal(db.prepare('SELECT project_id FROM script_library WHERE id = ?').get(deletedId)?.project_id, target.id)
    migrateWorkbench(db, 15)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM script_library').get()?.count, 2)
  } finally { database.close() }
})
