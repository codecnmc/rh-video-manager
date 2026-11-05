import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { WorkbenchWindows } from '../src/main/bootstrap/workbench-windows.ts'
import { registerWorkbenchWindows } from '../src/main/ipc/register-workbench-windows.ts'
import type { DesktopHandle } from '../src/main/ipc/handle.ts'
import type { WorkbenchPresence, WorkbenchWindowContext, WorkbenchWindowTarget } from '../src/shared/contracts/workbench-windows.ts'
import { workbenchWindowTargetSchema } from '../src/shared/contracts/workbench-windows.ts'
import { windowPeers } from '../src/renderer/src/features/workbench/window-presence.ts'
import { WorkbenchDatabase, SqliteWorkspaceRepository } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqlitePreferencesRepository } from '../src/main/infrastructure/database/preferences-repository.ts'
import { SqliteProjectRepository } from '../src/main/infrastructure/database/project-repository.ts'
import { SqliteScriptRepository } from '../src/main/infrastructure/database/script-repository.ts'
import { SqliteVideoDraftRepository } from '../src/main/infrastructure/database/video-repository.ts'
import { ProjectService } from '../src/main/modules/projects/application/project-service.ts'
import { ScriptService } from '../src/main/modules/scripts/application/script-service.ts'
import { VideoService } from '../src/main/modules/video/application/video-service.ts'
import { SettingsService } from '../src/main/modules/settings/application/settings-service.ts'
import { WorkspaceService } from '../src/main/application/workspace-service.ts'
import { createWorkspace } from '../src/main/bootstrap/create-workspace.ts'

class WorkspaceWindow extends EventEmitter {
  readonly webContents = new EventEmitter()
  destroyed = false
  constructor(readonly id: number) { super() }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.emit('closed') }
}

test('同一项目和画布可重复开窗，首次加载前已登记，各窗口上下文互不影响', async () => {
  const created: WorkspaceWindow[] = []
  const target: WorkbenchWindowTarget = { projectId: randomUUID(), view: 'image-generation', boardId: randomUUID() }
  const windows = new WorkbenchWindows(async (onCreated) => {
    const window = new WorkspaceWindow(created.length + 2)
    created.push(window)
    onCreated(window)
    assert.deepEqual(windows.context(window.id), target)
  })
  await windows.open(target)
  await windows.open(target)
  assert.equal(created.length, 2)
  assert.equal(windows.context(1), null)
  const original = { ...target }
  target.projectId = randomUUID()
  const snapshot = windows.context(2)!
  snapshot.boardId = null
  assert.deepEqual(windows.context(2), original)
  assert.deepEqual(windows.context(3), original)
  created[0]!.destroy()
  assert.equal(windows.context(2), null)
  assert.deepEqual(windows.context(3), original)
})

test('加载失败或渲染进程退出时销毁独立窗口并清理登记', async () => {
  const target: WorkbenchWindowTarget = { projectId: null, view: 'video', boardId: null }
  const failed = new WorkspaceWindow(2)
  const windows = new WorkbenchWindows(async (onCreated) => { onCreated(failed); throw new Error('load failed') })
  await assert.rejects(windows.open(target), /打开失败/)
  assert.equal(failed.destroyed, true)
  assert.equal(windows.context(2), null)
  const crashed = new WorkspaceWindow(3)
  const next = new WorkbenchWindows(async (onCreated) => { onCreated(crashed) })
  await next.open(target)
  crashed.webContents.emit('render-process-gone')
  assert.equal(crashed.destroyed, true)
  assert.equal(next.context(3), null)
})

async function fixture() {
  const database = new WorkbenchDatabase(':memory:')
  const db = database.connection
  const workspace = new WorkspaceService(new SqliteWorkspaceRepository(db, new ProjectService(new SqliteProjectRepository(db)),
    new ScriptService(new SqliteScriptRepository(db)), new VideoService(new SqliteVideoDraftRepository(db))), createWorkspace)
  const preferences = new SqlitePreferencesRepository(db)
  const environment = { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined }
  const settings = new SettingsService(preferences, environment)
  const initial = await workspace.load()
  const projects = ['项目甲', '项目乙'].map((name) => ({ id: randomUUID(), name, sample: false, episodes: [], videoDrafts: [] }))
  await workspace.save({ expectedRevision: initial.revision, workspace: { ...initial, projects } })
  const handlers = new Map<string, (input: unknown, window: BrowserWindow) => Promise<unknown>>()
  const handle: DesktopHandle = (channel, action) => { handlers.set(channel, action) }
  const created: WorkspaceWindow[] = []
  const windows = new WorkbenchWindows(async (onCreated) => { const window = new WorkspaceWindow(created.length + 2); created.push(window); onCreated(window) })
  const board = { id: randomUUID(), projectId: projects[0]!.id, title: '素材画布', revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hiddenNodeIds: [], positions: {} }
  registerWorkbenchWindows(handle, workspace, settings, windows, { board: (id) => {
    if (id !== board.id) throw new Error('画布不存在')
    return board
  } })
  const owners = new Map<number, WorkspaceWindow>([[1, new WorkspaceWindow(1)]])
  const ownerWindow = (id: number) => {
    const existing = created.find((window) => window.id === id) ?? owners.get(id)
    if (existing) return existing
    const window = new WorkspaceWindow(id)
    owners.set(id, window)
    return window
  }
  const invoke = (channel: string, input: unknown = undefined, owner = 1) => handlers.get(channel)!(input, ownerWindow(owner) as unknown as BrowserWindow)
  const context = async (owner = 1) => await invoke('workbench:window-context', undefined, owner) as WorkbenchWindowContext
  return { database, workspace, preferences, environment, settings, projects, windows, created, board, invoke, context, ownerWindow }
}

test('主窗口记住最后项目，SQLite 重建服务可读取，子窗口导航不改主窗口偏好', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.context()).projectId, f.projects[0]!.id)
    await f.invoke('workbench:remember-project', { projectId: f.projects[1]!.id })
    f.settings.save({ editorFontSize: 18 })
    assert.equal(new SettingsService(f.preferences, f.environment).preferences().lastProjectId, f.projects[1]!.id)
    assert.equal((await f.context()).projectId, f.projects[1]!.id)
    const target: WorkbenchWindowTarget = { projectId: f.projects[0]!.id, view: 'image-generation', boardId: f.board.id }
    await f.invoke('workbench:open-window', target)
    assert.deepEqual(await f.context(2), { ...target, detached: true })
    await f.invoke('workbench:remember-project', { projectId: f.projects[0]!.id }, 2)
    assert.equal(f.settings.preferences().lastProjectId, f.projects[1]!.id)
    assert.equal(f.settings.preferences().editorFontSize, 18)
  } finally { f.database.close() }
})

test('记忆项目已删除时回退可用项目，全部删除后保持空工作台', async () => {
  const f = await fixture()
  try {
    f.settings.save({ lastProjectId: f.projects[1]!.id })
    let current = await f.workspace.load()
    current = await f.workspace.remove({ expectedRevision: current.revision, kind: 'project', projectId: f.projects[1]!.id, id: f.projects[1]!.id })
    assert.equal((await f.context()).projectId, f.projects[0]!.id)
    await f.workspace.remove({ expectedRevision: current.revision, kind: 'project', projectId: f.projects[0]!.id, id: f.projects[0]!.id })
    assert.deepEqual(await f.context(), { projectId: null, view: 'video', boardId: null, detached: false })
  } finally { f.database.close() }
})

test('开窗校验项目与画布归属，拒绝非法目标且不修改工作区修订', async () => {
  const f = await fixture()
  try {
    const target: WorkbenchWindowTarget = { projectId: f.projects[0]!.id, view: 'image-generation', boardId: f.board.id }
    const revision = (await f.workspace.load()).revision
    await assert.rejects(f.invoke('workbench:open-window', { ...target, projectId: randomUUID() }), /项目不存在/)
    await assert.rejects(f.invoke('workbench:open-window', { ...target, projectId: f.projects[1]!.id }), /不属于/)
    await assert.rejects(f.invoke('workbench:open-window', { ...target, boardId: randomUUID() }), /画布不存在/)
    await assert.rejects(f.invoke('workbench:open-window', { ...target, view: 'video' }))
    await assert.rejects(f.invoke('workbench:open-window', { ...target, unsafe: true }))
    await assert.rejects(f.invoke('workbench:remember-project', { projectId: randomUUID() }), /项目不存在/)
    assert.equal(f.created.length, 0)
    await f.invoke('workbench:open-window', target)
    await f.invoke('workbench:open-window', target)
    assert.equal(f.created.length, 2)
    assert.equal((await f.workspace.load()).revision, revision)
  } finally { f.database.close() }
})

test('多个窗口共享工作区修订，旧快照不能覆盖已保存的另一窗口', async () => {
  const f = await fixture()
  try {
    const first = await f.workspace.load()
    const second = await f.workspace.load()
    const saved = await f.workspace.save({ expectedRevision: first.revision,
      workspace: { ...first, projects: first.projects.map((project, index) => index === 0 ? { ...project, name: '窗口甲已保存' } : project) } })
    await assert.rejects(f.workspace.save({ expectedRevision: second.revision,
      workspace: { ...second, projects: second.projects.map((project, index) => index === 0 ? { ...project, name: '窗口乙旧修改' } : project) } }), /其他窗口更新/)
    assert.deepEqual(await f.workspace.load(), saved)
  } finally { f.database.close() }
})

test('剧本库可以独立开窗并携带浏览位置，不改变主窗口项目或工作区修订', async () => {
  const f = await fixture()
  try {
    f.settings.save({ lastProjectId: f.projects[1]!.id })
    const before = await f.workspace.load()
    const target: WorkbenchWindowTarget = { projectId: f.projects[0]!.id, view: 'script-library', boardId: null,
      scriptId: randomUUID(), scriptUnassigned: true }
    await f.invoke('workbench:open-window', target)
    assert.deepEqual(await f.context(2), { ...target, detached: true })
    assert.equal((await f.context()).projectId, f.projects[1]!.id)
    assert.deepEqual(await f.workspace.load(), before)
    await f.invoke('workbench:open-window', { projectId: null, view: 'script-library', boardId: null })
    assert.equal((await f.context(3)).view, 'script-library')
    await assert.rejects(f.invoke('workbench:open-window', { ...target, projectId: randomUUID() }), /项目不存在/)
  } finally { f.database.close() }
})

test('新窗口目标严格限制页面和跨页面定位字段', () => {
  const target = { projectId: randomUUID(), view: 'script-library', boardId: null, scriptId: randomUUID(), scriptUnassigned: false }
  assert.equal(workbenchWindowTargetSchema.safeParse(target).success, true)
  assert.equal(workbenchWindowTargetSchema.safeParse({ ...target, boardId: randomUUID() }).success, false)
  assert.equal(workbenchWindowTargetSchema.safeParse({ ...target, scriptId: 'invalid' }).success, false)
  for (const view of ['video', 'image-generation', 'settings', 'assembly']) {
    assert.equal(workbenchWindowTargetSchema.safeParse({ ...target, view }).success, false)
  }
})

test('主窗口与额外窗口均报告同草稿占用，查看和未保存编辑分开统计', async () => {
  const f = await fixture()
  try {
    const current: WorkbenchPresence = { projectId: f.projects[0]!.id, view: 'video', draftId: randomUUID(), boardId: null, dirty: false }
    await f.invoke('workbench:report-presence', current)
    await f.invoke('workbench:report-presence', { ...current, dirty: true }, 2)
    await f.invoke('workbench:report-presence', { ...current, draftId: randomUUID() }, 3)
    let peers = windowPeers(current, f.windows.state(1))
    assert.equal(peers.project.length, 2)
    assert.equal(peers.document.length, 1)
    assert.equal(peers.editing.length, 1)
    await f.invoke('workbench:report-presence', { ...current, dirty: false }, 2)
    peers = windowPeers(current, f.windows.state(1))
    assert.equal(peers.document.length, 1)
    assert.equal(peers.editing.length, 0)
    await assert.rejects(f.invoke('workbench:report-presence', { ...current, windowId: 9 }, 2))
    await assert.rejects(f.invoke('workbench:report-presence', { ...current, boardId: f.board.id }, 2))
    f.ownerWindow(2).destroy()
    assert.equal(windowPeers(current, f.windows.state(1)).document.length, 0)
    f.ownerWindow(1).webContents.emit('render-process-gone')
    assert.equal(f.windows.state(3).windows.some((window) => window.windowId === 1), false)
  } finally { f.database.close() }
})

test('画布占用按具体画布统计，切换项目/页面及重新加载会释放旧目标', async () => {
  const f = await fixture()
  try {
    const current: WorkbenchPresence = { projectId: f.projects[0]!.id, view: 'image-generation', draftId: null, boardId: f.board.id, dirty: false }
    await f.invoke('workbench:report-presence', current)
    await f.invoke('workbench:report-presence', { ...current, dirty: true }, 2)
    assert.equal(windowPeers(current, f.windows.state(1)).editing.length, 1)
    const snapshot = f.windows.state(1)
    snapshot.windows[0]!.dirty = true
    assert.equal(f.windows.state(1).windows[0]!.dirty, false)
    await f.invoke('workbench:report-presence', { ...current, view: 'other', boardId: null }, 2)
    assert.equal(windowPeers(current, f.windows.state(1)).project.length, 1)
    assert.equal(windowPeers(current, f.windows.state(1)).document.length, 0)
    await f.invoke('workbench:report-presence', { ...current, projectId: f.projects[1]!.id }, 2)
    assert.equal(windowPeers(current, f.windows.state(1)).project.length, 0)
    f.ownerWindow(2).webContents.emit('did-start-loading')
    assert.equal(f.windows.state(1).windows.length, 1)
    await f.invoke('workbench:report-presence', current, 2)
    assert.equal(windowPeers(current, f.windows.state(1)).document.length, 1)
  } finally { f.database.close() }
})

test('占用变化才广播，窗口关闭或崩溃不留下占用记录', async () => {
  const window = new WorkspaceWindow(2)
  let changes = 0
  const windows = new WorkbenchWindows(async (onCreated) => { onCreated(window) }, () => { changes += 1 })
  const target: WorkbenchWindowTarget = { projectId: randomUUID(), view: 'video', boardId: null }
  await windows.open(target)
  const current: WorkbenchPresence = { ...target, view: 'video', draftId: randomUUID(), dirty: false }
  windows.report(2, current)
  windows.report(2, current)
  assert.equal(changes, 1)
  windows.report(2, { ...current, dirty: true })
  assert.equal(changes, 2)
  window.webContents.emit('render-process-gone')
  assert.deepEqual(windows.state(1).windows, [])
  assert.equal(changes, 3)
})
