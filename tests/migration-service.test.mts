import test from 'node:test'
import assert from 'node:assert/strict'
import { MigrationService } from '../src/main/modules/migration/application/migration-service.ts'
import type { MigrationArchive } from '../src/main/modules/migration/ports/migration.ts'

test('导出和导入区分准备模式，成功或失败均恢复后台工作', async () => {
  const modes: string[] = []
  let resumed = 0
  const archive: MigrationArchive = { assertEmpty: () => undefined,
    exportTo: async () => undefined, importFrom: async () => { throw new Error('损坏') } }
  const service = new MigrationService(archive, (mode) => {
    assert.equal(service.isBusy(), true)
    modes.push(mode)
    return () => { resumed++ }
  })
  await service.exportTo('/test/archive', 'test-password-only')
  await assert.rejects(service.importFrom('/test/archive', 'test-password-only'), /损坏/)
  assert.deepEqual(modes, ['export', 'import'])
  assert.equal(resumed, 2)
  assert.equal(service.isBusy(), false)
})

test('准备失败也释放迁移锁，不调用归档器', async () => {
  const archive: MigrationArchive = { assertEmpty: () => undefined,
    exportTo: async () => { assert.fail('不应开始导出') }, importFrom: async () => undefined }
  const service = new MigrationService(archive, () => { throw new Error('正在写文件') })
  await assert.rejects(service.exportTo('/test/archive', 'test-password-only'), /正在写文件/)
  assert.equal(service.isBusy(), false)
})

test('迁移期间互斥，导出完成后恢复可用，不并发调用归档器', async () => {
  let finish: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  let exports = 0
  const archive: MigrationArchive = { assertEmpty: () => undefined,
    exportTo: async () => { exports++; await waiting }, importFrom: async () => undefined }
  const service = new MigrationService(archive, () => undefined)
  const running = service.exportTo('/test/archive', 'test-password-only')
  assert.equal(service.isBusy(), true)
  assert.throws(() => service.assertAvailable(), /正在迁移/)
  await assert.rejects(service.exportTo('/other', 'test-password-only'), /正在迁移/)
  assert.equal(exports, 1)
  finish(); await running
  assert.equal(service.isBusy(), false)
  assert.doesNotThrow(() => service.assertAvailable())
})

test('非空或导入失败不进入重启锁，成功后必须重启', async () => {
  let empty = false, fail = true, imported = 0
  const archive: MigrationArchive = {
    assertEmpty: () => { if (!empty) throw new Error('非空工作台') }, exportTo: async () => undefined,
    importFrom: async () => { if (fail) throw new Error('损坏'); imported++ }
  }
  const service = new MigrationService(archive, () => undefined)
  await assert.rejects(service.importFrom('/test/archive', 'test-password-only'), /非空/)
  assert.equal(imported, 0); assert.doesNotThrow(() => service.assertAvailable())
  empty = true
  await assert.rejects(service.importFrom('/test/archive', 'test-password-only'), /损坏/)
  assert.doesNotThrow(() => service.assertAvailable())
  fail = false
  await service.importFrom('/test/archive', 'test-password-only')
  assert.equal(imported, 1)
  assert.equal(service.isBusy(), false)
  assert.throws(() => service.assertAvailable(), /重启/)
})
