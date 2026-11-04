import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase, SqliteWorkspaceRepository } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteScriptLibraryRepository } from '../src/main/infrastructure/database/script-library-repository.ts'
import { SqlitePreferencesRepository } from '../src/main/infrastructure/database/preferences-repository.ts'
import { SqliteProjectRepository } from '../src/main/infrastructure/database/project-repository.ts'
import { SqliteScriptRepository } from '../src/main/infrastructure/database/script-repository.ts'
import { SqliteVideoDraftRepository } from '../src/main/infrastructure/database/video-repository.ts'
import { ScriptLibraryService } from '../src/main/modules/scripts/application/script-library-service.ts'
import { ScriptService } from '../src/main/modules/scripts/application/script-service.ts'
import { ProjectService } from '../src/main/modules/projects/application/project-service.ts'
import { VideoService } from '../src/main/modules/video/application/video-service.ts'
import { WorkspaceService } from '../src/main/application/workspace-service.ts'
import { createWorkspace } from '../src/main/bootstrap/create-workspace.ts'
import { SettingsService } from '../src/main/modules/settings/application/settings-service.ts'
import { parseExtensionManifest } from '../src/main/modules/extensions/domain/manifest.ts'
import { startAssetMcpSchema } from '../src/shared/contracts/mcp.ts'

test('独立剧本库无需项目；保存和软删除校验修订，不允许复活', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const library = new ScriptLibraryService(new SqliteScriptLibraryRepository(database.connection), randomUUID)
    assert.deepEqual(library.list(), [])
    const first = library.save({ id: randomUUID(), title: '人物设定', markdown: '# 角色\n\n- 记录', expectedRevision: null })
    const next = library.save({ ...first, title: '设定与笔记', expectedRevision: first.revision })
    assert.equal(next.revision, first.revision + 1)
    assert.throws(() => library.save({ ...first, expectedRevision: first.revision }), /变更/)
    assert.throws(() => library.remove({ id: first.id, expectedRevision: first.revision }), /变更/)
    library.remove({ id: next.id, expectedRevision: next.revision })
    assert.deepEqual(library.list(), [])
    assert.throws(() => library.save({ ...next, expectedRevision: null }), /已存在/)
    assert.throws(() => library.save({ ...next, expectedRevision: next.revision }), /变更或删除/)
    assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM script_library').get()?.count, 1)
  } finally { database.close() }
})

test('文档备份仅含标题与 Markdown；恢复新增副本，非法批次不产生部分记录', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const library = new ScriptLibraryService(new SqliteScriptLibraryRepository(database.connection), randomUUID)
    const original = library.save({ id: randomUUID(), title: '笔记', markdown: '**正文**', expectedRevision: null })
    const backup = library.backup()
    assert.deepEqual(Object.keys(backup.documents[0]!).sort(), ['markdown', 'title'])
    assert.equal(library.restore(backup), 1)
    assert.equal(library.list().length, 2)
    assert.equal(library.list().filter((item) => item.id === original.id).length, 1)
    assert.throws(() => library.restore({ ...backup, documents: [...backup.documents, { title: '', markdown: '' }] }))
    assert.equal(library.list().length, 2)
  } finally { database.close() }
})

test('偏好设置独立落库并拒绝越界字号', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const repository = new SqlitePreferencesRepository(database.connection)
    const service = new SettingsService(repository, { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined })
    assert.equal(service.preferences().taskNotifications, false)
    const input = { editorMode: 'edit' as const, editorFontSize: 18, taskNotifications: true }
    assert.deepEqual(service.save(input), input)
    assert.deepEqual(service.preferences(), input)
    assert.throws(() => service.save({ ...input, editorFontSize: 100 }))
    assert.deepEqual(service.preferences(), input)
  } finally { database.close() }
})

test('首次引导偏好兼容旧数据，完成后持久化且不覆盖其他设置', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const repository = new SqlitePreferencesRepository(database.connection)
    const environment = { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined }
    const service = new SettingsService(repository, environment)
    assert.equal(service.preferences().onboardingVersion, undefined)
    service.save({ taskNotifications: true, mcpAutoStart: false, editorFontSize: 18 })
    service.save({ onboardingVersion: 1 })
    const restored = new SettingsService(repository, environment).preferences()
    assert.equal(restored.onboardingVersion, 1)
    assert.equal(restored.editorFontSize, 18)
    assert.equal(restored.taskNotifications, true)
    assert.equal(restored.mcpAutoStart, false)
    service.save({ assetLibraryView: 'tiles' })
    assert.equal(service.preferences().onboardingVersion, 1)
    for (const value of [-1, 0.5, NaN, Infinity]) assert.throws(() => service.save({ onboardingVersion: value }))
    assert.equal(service.preferences().onboardingVersion, 1)
  } finally { database.close() }
})

test('缩略图尺寸持久化保留其他偏好，拒绝越界和非步进值', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const directories = { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined }
    const service = new SettingsService(new SqlitePreferencesRepository(database.connection), directories)
    assert.equal(service.preferences().imageGenerationCardSize, undefined)
    service.save({ editorFontSize: 18, assetLibraryView: 'tiles' })
    for (const size of [220, 260, 400]) {
      service.save({ imageGenerationCardSize: size })
      const reloaded = new SettingsService(new SqlitePreferencesRepository(database.connection), directories)
      assert.equal(reloaded.preferences().imageGenerationCardSize, size)
      assert.equal(reloaded.preferences().editorFontSize, 18)
      assert.equal(reloaded.preferences().assetLibraryView, 'tiles')
    }
    for (const size of [200, 420, 230, 260.5, NaN, Infinity]) {
      assert.throws(() => service.save({ imageGenerationCardSize: size }))
      assert.equal(service.preferences().imageGenerationCardSize, 400)
    }
    service.save({ taskNotifications: true })
    assert.equal(service.preferences().imageGenerationCardSize, 400)
  } finally { database.close() }
})

test('撤回工作流模式后旧偏好仍可读取，局部保存保留显示与通知设置', () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const repository = new SqlitePreferencesRepository(database.connection)
    const service = new SettingsService(repository, { information: async () => ({ version: 'test', dataDirectory: 'data', logsDirectory: 'logs', availableBytes: null }), openDirectory: async () => undefined })
    const current = { editorMode: 'preview' as const, editorFontSize: 14, taskNotifications: true, assetLibraryView: 'tiles' as const }
    for (const workflowMode of ['builtin', 'account-default']) {
      database.connection.prepare('INSERT INTO app_preferences (singleton, data) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data = excluded.data')
        .run(JSON.stringify({ ...current, workflowMode }))
      assert.deepEqual(service.preferences(), current)
      const updated = { ...current, assetLibraryView: 'details' }
      assert.deepEqual(service.save({ assetLibraryView: 'details' }), updated)
      assert.deepEqual(repository.read(), updated)
    }
    assert.throws(() => service.save(JSON.parse('{"workflowMode":"builtin"}')))
    assert.throws(() => service.save({ editorFontSize: 100 }))
  } finally { database.close() }
})

test('MCP 授权不再要求次数额度，但仍校验有效期和项目', () => {
  assert.doesNotThrow(() => startAssetMcpSchema.parse({ projectId: randomUUID(), writeEnabled: true, minutes: 60 }))
  assert.throws(() => startAssetMcpSchema.parse({ projectId: '', writeEnabled: true, minutes: 60 }))
  assert.throws(() => startAssetMcpSchema.parse({ projectId: randomUUID(), writeEnabled: true, minutes: 0 }))
  assert.equal('maxWrites' in startAssetMcpSchema.shape, false)
  for (const minutes of [-1, 5, 120]) assert.doesNotThrow(() => startAssetMcpSchema.parse({ projectId: randomUUID(), writeEnabled: false, minutes }))
  for (const minutes of [-2, 0, 1, 4, 121, 5.5, NaN, Infinity]) assert.equal(startAssetMcpSchema.safeParse({ projectId: randomUUID(), writeEnabled: false, minutes }).success, false)
})

test('插件页面要求独立命名空间、显式激活事件和所选素材权限', () => {
  const input = { manifestVersion: 1, publisher: 'studio', name: 'agent', displayName: '工具', description: '', version: '1.0.0',
    engines: { videoWorkbench: '^1.0.0' }, main: './extension.cjs', activationEvents: ['onCommand'], permissions: ['assets.selection'],
    contributes: { pages: [{ id: 'studio.agent.page', title: 'Agent', acceptsAssets: true }] } }
  assert.equal(parseExtensionManifest(input).contributes.pages?.length, 1)
  assert.throws(() => parseExtensionManifest({ ...input, permissions: [] }), /assets.selection/)
  assert.throws(() => parseExtensionManifest({ ...input, activationEvents: [] }), /激活事件/)
  assert.throws(() => parseExtensionManifest({ ...input, contributes: { pages: [{ id: 'other.page', title: '越界' }] } }), /前缀/)
})

test('项目重命名保持分集、草稿标识和内容，并拒绝旧修订覆盖', async () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const db = database.connection
    const repository = new SqliteWorkspaceRepository(db, new ProjectService(new SqliteProjectRepository(db)),
      new ScriptService(new SqliteScriptRepository(db)), new VideoService(new SqliteVideoDraftRepository(db)))
    const service = new WorkspaceService(repository, createWorkspace)
    const empty = await service.load()
    const project = { id: randomUUID(), name: '原名称', sample: false, episodes: [{ id: randomUUID(), title: '第一集', script: '保留原文' }],
      videoDrafts: [{ id: randomUUID(), title: '草稿', description: '', prompt: '保留提示词', promptDocument: '', duration: 8, aspectRatio: '16:9' as const, resolution: '720P' as const, instance: 'plus' as const, instanceMode: 'auto' as const }] }
    const saved = await service.save({ expectedRevision: empty.revision, workspace: { ...empty, projects: [project] } })
    const next = await service.save({ expectedRevision: saved.revision, workspace: { ...saved, projects: saved.projects.map((item) => ({ ...item, name: '新名称' })) } })
    assert.deepEqual(next.projects[0]?.episodes, project.episodes)
    assert.deepEqual(next.projects[0]?.videoDrafts, saved.projects[0]?.videoDrafts)
    assert.equal(next.projects[0]?.name, '新名称')
    await assert.rejects(service.save({ expectedRevision: saved.revision, workspace: saved }), /其他窗口更新/)
  } finally { database.close() }
})
