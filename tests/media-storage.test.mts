import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteMediaStorageRepository } from '../src/main/infrastructure/database/media-storage-repository.ts'
import { LocalMediaStorageFiles } from '../src/main/infrastructure/files/media-storage-files.ts'
import { MediaStorageService } from '../src/main/modules/settings/application/media-storage-service.ts'
import type { MediaStorageFiles, MediaStorageRepository, MediaStorageState } from '../src/main/modules/settings/ports/media-storage.ts'

function memoryRepository(): MediaStorageRepository {
  let state: MediaStorageState = { directory: null, pendingDirectory: null, cleanupDirectory: null }
  return { read: () => ({ ...state }), write: (next) => { state = { ...next } } }
}

test('完整副本核验后才切换并清理，迁移失败仍使用旧目录', async () => {
  const repository = memoryRepository()
  const events: string[] = []
  let fail = true
  const files: MediaStorageFiles = {
    allocate: async () => '/selected/media',
    copy: async () => { events.push('copy'); if (fail) throw new Error('磁盘不足') },
    cleanup: async () => { assert.equal(repository.read().directory, '/selected/media'); events.push('cleanup') }
  }
  let service = new MediaStorageService(repository, files, '/default', () => undefined)
  await service.plan('/selected')
  assert.equal(service.status().directory, '/default')
  await service.initialize()
  assert.equal(service.status().directory, '/default')
  assert.equal(service.status().pendingDirectory, '/selected/media')
  assert.ok(service.status().error)
  assert.deepEqual(events, ['copy'])
  fail = false
  service = new MediaStorageService(repository, files, '/default', () => undefined)
  await service.initialize()
  assert.equal(service.status().directory, '/selected/media')
  assert.equal(service.status().pendingDirectory, null)
  assert.equal(service.status().cleanupDirectory, null)
  assert.deepEqual(events, ['copy', 'copy', 'cleanup'])
})

test('旧副本清理失败保留重试记录，下次启动不重复复制', async () => {
  const repository = memoryRepository()
  repository.write({ directory: null, pendingDirectory: '/new', cleanupDirectory: null })
  let copies = 0, cleanups = 0
  const files: MediaStorageFiles = { allocate: async () => '/new', copy: async () => { copies += 1 }, cleanup: async () => { if (++cleanups === 1) throw new Error('文件占用') } }
  await new MediaStorageService(repository, files, '/old', () => undefined).initialize()
  assert.equal(repository.read().directory, '/new')
  assert.equal(repository.read().cleanupDirectory, '/old')
  await new MediaStorageService(repository, files, '/old', () => undefined).initialize()
  assert.equal(repository.read().cleanupDirectory, null)
  assert.equal(copies, 1)
  assert.equal(cleanups, 2)
})

test('配置写入失败不清理原文件，忙碌时不分配目标目录，取消保留副本', async () => {
  const repository = memoryRepository()
  let busy = true, allocations = 0, cleanups = 0
  const files: MediaStorageFiles = {
    allocate: async () => { allocations += 1; return '/new' }, copy: async () => undefined,
    cleanup: async () => { cleanups += 1 }
  }
  const service = new MediaStorageService(repository, files, '/old', () => { if (busy) throw new Error('仍有任务') })
  await assert.rejects(service.plan('/parent'), /仍有任务/)
  assert.equal(allocations, 0)
  busy = false
  await service.plan('/parent')
  busy = true
  assert.throws(() => service.assertCanRestart(), /仍有任务/)
  const failing = new MediaStorageService({ read: repository.read, write: () => { throw new Error('数据库写入失败') } }, files, '/old', () => undefined)
  await failing.initialize()
  assert.equal(failing.status().directory, '/old')
  assert.equal(cleanups, 0)
  service.cancel()
  assert.equal(repository.read().pendingDirectory, null)
  assert.equal(cleanups, 0)
})

test('SQLite 保存存储位置，不影响编辑器偏好', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const repository = new SqliteMediaStorageRepository(database.connection)
    assert.equal(repository.read().directory, null)
    repository.write({ directory: 'D:\\media', pendingDirectory: 'E:\\media', cleanupDirectory: null })
    assert.equal(new SqliteMediaStorageRepository(database.connection).read().pendingDirectory, 'E:\\media')
    assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM app_preferences').get()?.count, 0)
  } finally { database.close() }
})

test('跨目录复制媒体和采样并保留相对文件名，仅清理旧媒体，不碰数据库和日志', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-media-storage-'))
  try {
    const source = join(directory, 'original')
    await mkdir(join(source, 'assets', 'nested'), { recursive: true })
    await mkdir(join(source, 'sampling'))
    await mkdir(join(source, 'production-staging'))
    await mkdir(join(source, 'database'))
    await mkdir(join(source, 'logs'))
    await writeFile(join(source, 'assets', 'nested', 'image.png'), 'image bytes')
    await writeFile(join(source, 'sampling', 'preview.mp4'), 'sampling bytes')
    await writeFile(join(source, 'production-staging', 'voice.wav'), 'audio bytes')
    await writeFile(join(source, 'database', 'workbench.sqlite'), 'database bytes')
    await writeFile(join(source, 'logs', 'keep.log'), 'logs')
    const files = new LocalMediaStorageFiles()
    const target = await files.allocate(directory, source)
    await files.copy(source, target)
    await files.copy(source, target)
    assert.equal(await readFile(join(target, 'assets', 'nested', 'image.png'), 'utf8'), 'image bytes')
    assert.equal(await readFile(join(target, 'sampling', 'preview.mp4'), 'utf8'), 'sampling bytes')
    assert.equal(await readFile(join(source, 'assets', 'nested', 'image.png'), 'utf8'), 'image bytes')
    await files.cleanup(source, target)
    await assert.rejects(stat(join(source, 'assets')), { code: 'ENOENT' })
    assert.equal(await readFile(join(source, 'database', 'workbench.sqlite'), 'utf8'), 'database bytes')
    assert.equal(await readFile(join(source, 'logs', 'keep.log'), 'utf8'), 'logs')
    assert.equal(await readFile(join(target, 'production-staging', 'voice.wav'), 'utf8'), 'audio bytes')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('拒绝新旧路径嵌套、覆盖冲突和删除内容不同的旧副本', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-media-safety-'))
  try {
    const source = join(directory, 'original')
    await mkdir(join(source, 'assets'), { recursive: true })
    await writeFile(join(source, 'assets', 'image.png'), 'original')
    const files = new LocalMediaStorageFiles()
    await assert.rejects(files.allocate(source, source), /包含/)
    const target = await files.allocate(directory, source)
    await mkdir(join(target, 'assets'))
    await writeFile(join(target, 'assets', 'image.png'), 'different')
    await assert.rejects(files.copy(source, target), /不同内容/)
    await assert.rejects(files.cleanup(source, target), /变化|不可读取/)
    assert.equal(await readFile(join(source, 'assets', 'image.png'), 'utf8'), 'original')
    assert.equal(await readFile(join(target, 'assets', 'image.png'), 'utf8'), 'different')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('拒绝通过符号链接或目录联接迁移到受管范围外', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-media-links-'))
  try {
    const source = join(directory, 'original'), outside = join(directory, 'outside')
    await mkdir(source)
    await mkdir(outside)
    await writeFile(join(outside, 'keep.png'), 'outside bytes')
    await symlink(outside, join(source, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    const files = new LocalMediaStorageFiles()
    const target = await files.allocate(directory, source)
    await assert.rejects(files.copy(source, target), /链接|越界/)
    assert.equal(await readFile(join(outside, 'keep.png'), 'utf8'), 'outside bytes')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
