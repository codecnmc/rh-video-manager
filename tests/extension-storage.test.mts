import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ExtensionStorageSession } from '../src/main/infrastructure/extensions/storage.ts'
import { SqliteProductionRepository } from '../src/main/infrastructure/database/production-repository.ts'
import { extensionStorageManifestSchema, extensionStorageOperationSchema } from '../src/shared/contracts/extensions.ts'
import { hostStorageRequestSchema, hostOpenStorageRequestSchema } from '../src/main/infrastructure/extensions/host-protocol.ts'

test('加载前创建独立表，同名表不影响本体或其他插件，重复加载保留数据', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-plugin-storage-'))
  const core = new DatabaseSync(join(directory, 'workbench.sqlite'))
  let first: ExtensionStorageSession | undefined
  let second: ExtensionStorageSession | undefined
  try {
    core.exec("CREATE TABLE production_defaults (key TEXT PRIMARY KEY, value TEXT); INSERT INTO production_defaults VALUES ('voice', 'core')")
    const root = join(directory, 'extensions')
    const schema = { version: 1, tables: ['production_defaults'] }
    first = await ExtensionStorageSession.open(root, 'studio.first', schema)
    second = await ExtensionStorageSession.open(root, 'studio.second', schema)
    first.execute({ operation: 'set', table: 'production_defaults', key: 'voice', value: { id: '45' } })
    assert.equal(second.execute({ operation: 'get', table: 'production_defaults', key: 'voice' }), null)
    assert.equal(core.prepare('SELECT value FROM production_defaults').get()?.value, 'core')
    first.close()
    assert.throws(() => first!.execute({ operation: 'get', table: 'production_defaults', key: 'voice' }), /撤销/)
    first = await ExtensionStorageSession.open(root, 'studio.first', schema)
    assert.deepEqual(first.execute({ operation: 'get', table: 'production_defaults', key: 'voice' }), { key: 'voice', value: { id: '45' } })
    first.execute({ operation: 'delete', table: 'production_defaults', key: 'voice' })
    assert.equal(first.execute({ operation: 'get', table: 'production_defaults', key: 'voice' }), null)
  } finally { first?.close(); second?.close(); core.close(); await rm(directory, { recursive: true, force: true }) }
})

test('同版本变更与版本回退失败，升级只增表，不删除历史记录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-plugin-storage-'))
  let session: ExtensionStorageSession | undefined
  try {
    const v1 = { version: 1, tables: ['voices'] }
    session = await ExtensionStorageSession.open(directory, 'studio.first', v1)
    session.execute({ operation: 'set', table: 'voices', key: '45', value: 'preset' })
    session.close()
    await assert.rejects(ExtensionStorageSession.open(directory, 'studio.first', { version: 1, tables: ['other'] }), /提升版本/)
    session = await ExtensionStorageSession.open(directory, 'studio.first', { version: 2, tables: ['voices', 'other'] })
    assert.deepEqual(session.execute({ operation: 'get', table: 'voices', key: '45' }), { key: '45', value: 'preset' })
    session.close()
    await assert.rejects(ExtensionStorageSession.open(directory, 'studio.first', v1), /版本回退/)
    session = await ExtensionStorageSession.open(directory, 'studio.first', { version: 3, tables: ['other'] })
    assert.throws(() => session!.execute({ operation: 'get', table: 'voices', key: '45' }), /未声明/)
    session.close()
    session = await ExtensionStorageSession.open(directory, 'studio.first', { version: 4, tables: ['voices', 'other'] })
    assert.deepEqual(session.execute({ operation: 'get', table: 'voices', key: '45' }), { key: '45', value: 'preset' })
  } finally { session?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('未声明表、路径、跨插件身份、SQL 和越限记录均被接口拒绝', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-plugin-storage-'))
  const session = await ExtensionStorageSession.open(directory, 'studio.first', { version: 1, tables: ['voices'] })
  try {
    assert.throws(() => session.execute({ operation: 'get', table: 'projects', key: 'p' }), /未声明/)
    for (const input of [
      { operation: 'get', table: 'voices', key: '45', extensionId: 'studio.second' },
      { operation: 'get', table: '../projects', key: 'p' },
      { operation: 'sql', sql: 'ATTACH DATABASE workbench.sqlite AS core' },
      { operation: 'set', table: 'voices', key: '45', value: 'a'.repeat(65537) },
      { operation: 'list', table: 'voices', limit: 101 }
    ]) assert.equal(extensionStorageOperationSchema.safeParse(input).success, false)
    const request = { kind: 'storage', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input: { operation: 'get', table: 'voices', key: '45' } }
    assert.equal(hostStorageRequestSchema.safeParse(request).success, true)
    assert.equal(hostStorageRequestSchema.safeParse({ ...request, database: 'workbench.sqlite' }).success, false)
    assert.equal(hostOpenStorageRequestSchema.safeParse({ kind: 'open-storage-directory', requestId: request.requestId, path: 'C:\\Windows' }).success, false)
    assert.equal(extensionStorageManifestSchema.safeParse({ version: 1, tables: ['voices', 'voices'] }).success, false)
    await assert.rejects(ExtensionStorageSession.open(directory, '../core', { version: 1, tables: ['voices'] }))
  } finally { session.close(); await rm(directory, { recursive: true, force: true }) }
})

test('分页读取有界且按键续读，未声明存储的旧插件不能使用任何表', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-plugin-storage-'))
  const session = await ExtensionStorageSession.open(directory, 'studio.first', { version: 1, tables: ['voices'] })
  let legacy: ExtensionStorageSession | undefined
  try {
    for (const key of ['a', 'b', 'c']) session.execute({ operation: 'set', table: 'voices', key, value: key })
    assert.deepEqual(session.execute({ operation: 'list', table: 'voices', limit: 2 }), [{ key: 'a', value: 'a' }, { key: 'b', value: 'b' }])
    assert.deepEqual(session.execute({ operation: 'list', table: 'voices', after: 'b', limit: 2 }), [{ key: 'c', value: 'c' }])
    legacy = await ExtensionStorageSession.open(directory, 'studio.legacy')
    assert.throws(() => legacy!.execute({ operation: 'get', table: 'voices', key: 'a' }), /未声明/)
  } finally { session.close(); legacy?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('初始化拒绝目录联接，不沿链接打开数据库', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-plugin-storage-'))
  try {
    const target = join(directory, 'target')
    const link = join(directory, 'link')
    await mkdir(target)
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(ExtensionStorageSession.open(link, 'studio.first', { version: 1, tables: ['voices'] }), /链接/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('本体生产模块自初始化补齐缺表，不改全局版本或已有角色配置', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE video_drafts (id TEXT PRIMARY KEY);
      CREATE TABLE assets (id TEXT PRIMARY KEY); PRAGMA user_version = 99`)
    const repository = new SqliteProductionRepository(database)
    assert.deepEqual(repository.projectVoices('project'), { projectId: 'project', revision: 0, bindings: [] })
    database.prepare('INSERT INTO production_defaults VALUES (?, ?)').run('project', JSON.stringify({ projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 3, bindings: [] }))
    new SqliteProductionRepository(database)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM production_defaults').get()?.count, 1)
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 99)
  } finally { database.close() }
})
