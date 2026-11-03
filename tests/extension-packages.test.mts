import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedExtensionPackages } from '../src/main/infrastructure/extensions/package-store.ts'

const manifest = {
  manifestVersion: 1, publisher: 'studio', name: 'tools', displayName: '工具', description: '', version: '1.0.0',
  engines: { videoWorkbench: '^1.0.0' }, main: './extension.cjs', activationEvents: ['onCommand'], permissions: [],
  contributes: { commands: [{ id: 'studio.tools.check', title: '检查' }] }
}

test('插件安装读取内容快照，不运行入口；源目录变化不会改变安装包', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-extension-'))
  try {
    const source = join(root, 'package')
    const managed = join(root, 'managed')
    await mkdir(source)
    await writeFile(join(source, 'extension.json'), JSON.stringify(manifest))
    await writeFile(join(source, 'extension.cjs'), 'throw new Error("must not run during install")')
    const store = new ManagedExtensionPackages(managed)
    const staged = await store.stage(source)
    const record = { ...staged, id: 'studio.tools', enabled: false, installedAt: '2026-10-19T00:00:00.000Z', settings: {} }
    await store.verify(record)
    await writeFile(join(source, 'extension.cjs'), 'source changed')
    await store.verify(record)
    assert.match(await readFile(join(managed, staged.packageKey, 'extension.cjs'), 'utf8'), /must not run/)
    await writeFile(join(managed, staged.packageKey, 'extension.cjs'), 'tampered')
    await assert.rejects(store.verify(record), /修改/)
    await assert.rejects(store.discard('../outside'))
    await store.discard(staged.packageKey)
    assert.equal(await readFile(join(source, 'extension.cjs'), 'utf8'), 'source changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('拒绝目录联接、缺失入口、未知宿主版本和没有清单的目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-extension-'))
  try {
    const source = join(root, 'package')
    const other = join(root, 'outside')
    await mkdir(source)
    await mkdir(other)
    const store = new ManagedExtensionPackages(join(root, 'managed'))
    await assert.rejects(store.stage(source), /extension.json/)
    await writeFile(join(source, 'extension.json'), JSON.stringify(manifest))
    await assert.rejects(store.stage(source), /入口/)
    await writeFile(join(source, 'extension.cjs'), 'exports.activate = () => {}')
    await writeFile(join(source, 'extension.json'), JSON.stringify({ ...manifest, engines: { videoWorkbench: '^99.0.0' } }))
    await assert.rejects(store.stage(source))
    await writeFile(join(source, 'extension.json'), JSON.stringify(manifest))
    await symlink(other, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(store.stage(source), /链接|联接/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
