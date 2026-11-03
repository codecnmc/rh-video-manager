import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { AssemblyWindows } from '../src/main/bootstrap/assembly-windows.ts'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqlitePreferencesRepository } from '../src/main/infrastructure/database/preferences-repository.ts'
import { SettingsService } from '../src/main/modules/settings/application/settings-service.ts'

class EditorWindow extends EventEmitter {
  readonly webContents = new EventEmitter()
  minimized = true
  destroyed = false
  focused = 0
  shown = 0
  constructor(readonly id: number) { super() }
  isMinimized() { return this.minimized }
  restore() { this.minimized = false }
  show() { this.shown += 1 }
  focus() { this.focused += 1 }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.emit('closed') }
}

test('独立窗口按项目锁定，主窗口不能写，其他项目不受影响，重复打开只唤回', async () => {
  const window = new EditorWindow(2)
  let created = 0
  let changed = 0
  const windows = new AssemblyWindows(async (onCreated) => { created += 1; onCreated(window) }, () => { changed += 1 })
  const target = { projectId: randomUUID(), id: randomUUID() }
  await windows.open(target, 1)
  assert.equal(windows.hasProject(target.projectId), true)
  assert.deepEqual(windows.state(2).context, target)
  assert.equal(windows.state(1).context, null)
  assert.throws(() => windows.assertEditable(target.projectId, 1), /独立剪辑窗口/)
  assert.doesNotThrow(() => windows.assertEditable(target.projectId, 2))
  assert.doesNotThrow(() => windows.assertEditable(randomUUID(), 1))
  assert.throws(() => windows.assertEditable(randomUUID(), 2), /其他项目/)
  await windows.open({ ...target, id: randomUUID() }, 1)
  assert.equal(created, 1)
  assert.equal(window.focused, 1)
  assert.equal(window.minimized, false)
  await assert.rejects(windows.open(target, 2), /主窗口/)
  window.destroy()
  assert.equal(windows.hasProject(target.projectId), false)
  assert.deepEqual(windows.state(1).locks, [])
  assert.doesNotThrow(() => windows.assertEditable(target.projectId, 1))
  assert.equal(changed, 2)
})

test('窗口创建尚未完成时已锁定项目，重复请求不创建第二个窗口', async () => {
  let complete: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { complete = resolve })
  const windows = new AssemblyWindows(async (onCreated) => { await pending; onCreated(new EditorWindow(2)) }, () => undefined)
  const target = { projectId: null, id: randomUUID() }
  const opening = windows.open(target, 1)
  assert.equal(windows.hasProject(null), true)
  assert.throws(() => windows.assertEditable(null, 1), /独立剪辑窗口/)
  await assert.rejects(windows.open(target, 1), /正在打开/)
  complete!()
  await opening
  assert.doesNotThrow(() => windows.assertEditable(null, 2))
})

test('加载失败和渲染进程退出均释放项目锁', async () => {
  const target = { projectId: randomUUID(), id: randomUUID() }
  const failed = new EditorWindow(2)
  const windows = new AssemblyWindows(async (onCreated) => { onCreated(failed); throw new Error('load failed') }, () => undefined)
  await assert.rejects(windows.open(target, 1), /打开失败/)
  assert.equal(failed.destroyed, true)
  assert.equal(windows.hasProject(target.projectId), false)
  const crashed = new EditorWindow(3)
  const next = new AssemblyWindows(async (onCreated) => { onCreated(crashed) }, () => undefined)
  await next.open(target, 1)
  crashed.webContents.emit('render-process-gone')
  assert.equal(next.hasProject(target.projectId), false)
})

test('选集位置存入 SQLite 偏好，重建服务可回读，局部保存不影响其他偏好', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const repository = new SqlitePreferencesRepository(database.connection)
    const environment = { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined }
    const settings = new SettingsService(repository, environment)
    const projectId = randomUUID()
    const selections = { [projectId]: randomUUID(), public: randomUUID() }
    settings.save({ taskNotifications: true, assemblySelections: selections })
    settings.save({ editorFontSize: 18 })
    const restored = new SettingsService(repository, environment).preferences()
    assert.deepEqual(restored.assemblySelections, selections)
    assert.equal(restored.taskNotifications, true)
    assert.equal(restored.editorFontSize, 18)
    assert.throws(() => settings.save({ assemblySelections: { public: 'invalid-id' } }))
    assert.deepEqual(settings.preferences().assemblySelections, selections)
  } finally { database.close() }
})
