import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ExtensionService } from '../src/main/modules/extensions/application/extension-service.ts'
import { ExtensionPageService } from '../src/main/modules/extensions/application/extension-page-service.ts'
import { parseExtensionManifest, validateExtensionSettings } from '../src/main/modules/extensions/domain/manifest.ts'
import type { ExtensionRecord, ExtensionRepository, ExtensionHost, ExtensionPackages, ExtensionVault } from '../src/main/modules/extensions/ports/extensions.ts'
import { SqliteExtensionRepository } from '../src/main/infrastructure/database/extension-repository.ts'
import { migrateWorkbench, workbenchSchemaVersion } from '../src/main/infrastructure/database/migrations.ts'
import { randomUUID } from 'node:crypto'

test('独立页面只传所选同项目或公共素材快照，撤权、跨项目及确认后变更均拒绝', async () => {
  const app = await installedAndEnabled()
  const record = app.rows.get('studio.speech')!
  record.manifest = parseExtensionManifest({ ...record.manifest, permissions: [...record.manifest.permissions, 'assets.selection'],
    contributes: { ...record.manifest.contributes, pages: [{ id: 'studio.speech.page', title: '工具页', acceptsAssets: true }] } })
  const projectId = randomUUID()
  const asset = { id: randomUUID(), projectId, name: '参考', kind: 'image' as const, prompt: '原提示词', notes: '', tags: [], archived: false }
  let pageCalls = 0
  app.host.page = async (_id, _pageId, context) => {
    pageCalls += 1
    assert.equal('path' in context.assets[0]!, false)
    return { title: '结果', text: context.assets[0]!.prompt }
  }
  const pages = new ExtensionPageService(app.service, { projectExists: async (id) => id === projectId, asset: () => ({ ...asset }) })
  const request = { id: record.id, pageId: 'studio.speech.page', projectId, text: '输入', assetIds: [asset.id] }
  const prepared = await pages.prepare(request)
  assert.equal(pageCalls, 0)
  const result = await pages.run(request, prepared.context)
  assert.equal(result?.text, '原提示词')
  assert.equal(pageCalls, 1)
  await assert.rejects(pages.prepare({ ...request, projectId: null }), /只能引用/)
  asset.prompt = '确认期间发生变化'
  await assert.rejects(pages.run(request, prepared.context), /内容已变化/)
  asset.archived = true
  await assert.rejects(pages.prepare(request), /未归档/)
  asset.archived = false
  await app.service.setEnabled(record.id, false)
  await assert.rejects(pages.prepare(request), /停用/)
  assert.equal(pageCalls, 1)
})

function manifestInput() {
  return {
    manifestVersion: 1, publisher: 'studio', name: 'speech', displayName: '本地语音', description: '本地模型接口', version: '1.0.0',
    engines: { videoWorkbench: '^1.0.0' }, main: './extension.cjs', activationEvents: ['onCommand', 'onSpeech'],
    permissions: ['network.local', 'audio.reference'], contributes: {
      commands: [{ id: 'studio.speech.check', title: '检查服务' }],
      speechProviders: [{ id: 'studio.speech.local', name: '本地引擎', runtime: 'local', capabilities: { presetVoices: true, voiceCloning: true, emotion: false } }],
      configuration: [{ key: 'endpoint', title: '本机服务地址', type: 'string', required: true }, { key: 'api-key', title: '密钥', type: 'secret', required: false }]
    }
  }
}

function setup() {
  const manifest = parseExtensionManifest(manifestInput())
  const rows = new Map<string, ExtensionRecord>()
  const credentials = new Map<string, Uint8Array>()
  const events: string[] = []
  let active = false
  let failStart = false
  const repository: ExtensionRepository = {
    list: () => [...rows.values()], save: (record) => { rows.set(record.id, record) },
    remove: (id) => { rows.delete(id); credentials.clear() },
    secretKeys: () => [...credentials.keys()], readSecrets: () => Object.fromEntries(credentials),
    saveSecret: (_id, key, cipher) => { if (cipher) credentials.set(key, cipher); else credentials.delete(key) }
  }
  const packages: ExtensionPackages = {
    stage: async () => ({ manifest, packageKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', digest: 'a'.repeat(64) }),
    verify: async () => { events.push('verify') }, discard: async () => { events.push('discard') }
  }
  let givenSecrets: Record<string, string> = {}
  const host: ExtensionHost = {
    start: async (_record, secrets) => { events.push('start'); givenSecrets = secrets; if (failStart) throw new Error('activation failed'); active = true },
    command: async () => { events.push('command') }, voices: async () => [{ id: 'voice-1', name: '音色', language: 'zh', source: 'preset' }],
    contextCommand: async () => ({ title: '修改建议', text: '待审阅文本' }), synthesize: async () => { events.push('synthesize'); throw new Error('fixture audio not set') },
    stop: () => { events.push('stop'); active = false }, stopAll: () => { events.push('stopAll'); active = false },
    state: () => ({ status: active ? 'active' : 'idle', error: null })
  }
  const vault: ExtensionVault = { encrypt: (value) => new TextEncoder().encode(value), decrypt: (cipher) => new TextDecoder().decode(cipher) }
  const service = new ExtensionService(repository, packages, host, vault)
  return { service, rows, events, packages, vault, credentials, host, secrets: () => givenSecrets, fail: () => { failStart = true } }
}

async function installedAndEnabled() {
  const context = setup()
  await context.service.install('local-package', async () => true)
  await context.service.saveSettings({ id: 'studio.speech', values: { endpoint: 'http://127.0.0.1:9000' } })
  await context.service.setEnabled('studio.speech', true)
  return context
}

test('清单兼容性、入口边界、命名空间和未知权限均严格校验', () => {
  const input = manifestInput()
  assert.equal(parseExtensionManifest(input).main, './extension.cjs')
  for (const main of ['../escape.cjs', './a/../../escape.cjs', 'C:\\escape.cjs', './extension.js']) assert.throws(() => parseExtensionManifest({ ...input, main }))
  assert.throws(() => parseExtensionManifest({ ...input, engines: { videoWorkbench: '^2.0.0' } }))
  assert.throws(() => parseExtensionManifest({ ...input, permissions: ['arbitrary-files'] }))
  assert.throws(() => parseExtensionManifest({ ...input, scripts: { install: 'untrusted' } }))
  assert.throws(() => parseExtensionManifest({ ...input, contributes: { ...input.contributes, configuration: [{ key: 'constructor', title: '保留键', type: 'string' }] } }))
  assert.throws(() => parseExtensionManifest({ ...input, contributes: { ...input.contributes, commands: [{ id: 'other.check', title: '检查' }] } }))
})

test('本地文件模型、云端和克隆能力分别要求明确声明用途', () => {
  const input = manifestInput()
  assert.doesNotThrow(() => parseExtensionManifest({ ...input, permissions: ['models.local', 'audio.reference'] }))
  assert.throws(() => parseExtensionManifest({ ...input, permissions: ['network.local'] }))
  const cloud = { ...input, contributes: { ...input.contributes, speechProviders: input.contributes.speechProviders.map((provider) => ({ ...provider, runtime: 'cloud' })) } }
  assert.throws(() => parseExtensionManifest(cloud))
  assert.doesNotThrow(() => parseExtensionManifest({ ...cloud, permissions: ['network.cloud', 'audio.reference'] }))
})

test('安装默认停用；启用只校验完整性，不激活插件', async () => {
  const { service, events } = setup()
  const installed = await service.install('local-package', async () => true)
  assert.equal(installed[0]?.status, 'disabled')
  assert.equal(installed[0]?.configured, false)
  await service.setEnabled('studio.speech', true)
  assert.deepEqual(events, ['verify'])
  assert.equal(service.list()[0]?.status, 'idle')
})

test('取消安装或重复安装时清理暂存包，不执行插件代码', async () => {
  const { service, events } = setup()
  assert.deepEqual(await service.install('local-package', async () => false), [])
  assert.deepEqual(events, ['discard'])
  await service.install('local-package', async () => true)
  await assert.rejects(service.install('local-package', async () => true), /已安装/)
  assert.equal(events.filter((event) => event === 'discard').length, 2)
  assert.equal(events.includes('start'), false)
})

test('停用和未配置时阻断调用；显式命令才按需激活', async () => {
  const { service, events } = setup()
  await service.install('local-package', async () => true)
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'), /停用/)
  await service.setEnabled('studio.speech', true)
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'), /尚未配置/)
  await service.saveSettings({ id: 'studio.speech', values: { endpoint: 'http://127.0.0.1:9000' } })
  await service.runCommand('studio.speech', 'studio.speech.check')
  await service.runCommand('studio.speech', 'studio.speech.check')
  assert.equal(events.filter((event) => event === 'start').length, 1)
  assert.equal(events.filter((event) => event === 'command').length, 2)
  await assert.rejects(service.runCommand('studio.speech', 'other.command'), /未声明/)
})

test('普通配置不能包含密钥或未声明字段；密钥只送给所属插件宿主', async () => {
  const { service, secrets, credentials } = await installedAndEnabled()
  await assert.rejects(service.saveSettings({ id: 'studio.speech', values: { 'api-key': 'secret-value' } }))
  await assert.rejects(service.saveSettings({ id: 'studio.speech', values: { unknown: 'value' } }))
  await service.saveSecret({ id: 'studio.speech', key: 'api-key', value: 'secret-value' })
  const snapshot = JSON.stringify(service.list())
  assert.equal(snapshot.includes('secret-value'), false)
  assert.deepEqual(service.list()[0]?.configuredSecrets, ['api-key'])
  await service.listVoices('studio.speech', 'studio.speech.local')
  assert.equal(secrets()['api-key'], 'secret-value')
  await service.saveSecret({ id: 'studio.speech', key: 'api-key', value: '' })
  assert.equal(credentials.size, 0)
})

test('系统加密失败时不降级保存密钥', async () => {
  const { service, vault, credentials } = await installedAndEnabled()
  vault.encrypt = () => { throw new Error('encryption unavailable') }
  await assert.rejects(service.saveSecret({ id: 'studio.speech', key: 'api-key', value: 'secret-value' }))
  assert.equal(credentials.size, 0)
})

test('安装包校验失败阻断启用和激活；激活失败不会自动重试', async () => {
  const { service, packages, events, fail } = await installedAndEnabled()
  packages.verify = async () => { throw new Error('package modified') }
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'))
  assert.equal(events.includes('start'), false)
  await service.setEnabled('studio.speech', false)
  await assert.rejects(service.setEnabled('studio.speech', true))
  packages.verify = async () => undefined
  await service.setEnabled('studio.speech', true)
  fail()
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'))
  assert.equal(events.filter((event) => event === 'start').length, 1)
})

test('卸载只移除登记与凭据，不删除包存档或生成文件', async () => {
  const { service, events } = await installedAndEnabled()
  await service.remove('studio.speech')
  assert.deepEqual(service.list(), [])
  assert.equal(events.includes('discard'), false)
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'), /未安装/)
})

test('语音返回值边界校验且关闭后不再激活', async () => {
  const { service, host, events } = await installedAndEnabled()
  host.voices = async () => [{ id: 123, name: 'bad' }]
  await assert.rejects(service.listVoices('studio.speech', 'studio.speech.local'))
  service.stopAll()
  await assert.rejects(service.runCommand('studio.speech', 'studio.speech.check'), /关闭/)
  assert.equal(events.filter((event) => event === 'start').length, 1)
})

test('配置类型检查保持布尔和数字类型，不使用 any 绕过', () => {
  const manifest = parseExtensionManifest(manifestInput())
  assert.throws(() => validateExtensionSettings(manifest, { endpoint: true }))
  assert.doesNotThrow(() => validateExtensionSettings(manifest, { endpoint: 'http://127.0.0.1:9000' }))
})

test('能力注册表不会激活插件，停用或缺少配置的引擎不可生产', async () => {
  const { service, events } = setup()
  await service.install('local-package', async () => true)
  assert.equal(service.speechCapabilities()[0]?.available, false)
  await service.setEnabled('studio.speech', true)
  assert.equal(service.speechCapabilities()[0]?.available, false)
  await service.saveSettings({ id: 'studio.speech', values: { endpoint: 'local-service' } })
  assert.equal(service.speechCapabilities()[0]?.available, true)
  assert.equal(events.includes('start'), false)
})

test('不支持的语气和时长请求在激活前拒绝，不静默忽略', async () => {
  const { service, events } = await installedAndEnabled()
  const request = { text: '你好', voiceId: 'voice-1', language: 'zh', delivery: { description: '激动' } }
  await assert.rejects(service.synthesize('studio.speech', 'studio.speech.local', request, new AbortController().signal), /语气/)
  await assert.rejects(service.synthesize('studio.speech', 'studio.speech.local', { ...request, delivery: { description: '' }, targetDurationMs: 1000 }, new AbortController().signal), /时长/)
  assert.equal(events.includes('start'), false)
})

test('合成前拒绝已变化的配置快照，不拿新模型执行旧任务', async () => {
  const { service, events } = await installedAndEnabled()
  const capability = service.speechCapabilities()[0]!
  await service.saveSettings({ id: capability.extensionId, values: { endpoint: 'changed-service' } })
  await assert.rejects(service.synthesize(capability.extensionId, capability.provider.id,
    { text: '你好', voiceId: 'voice-1', language: 'zh', delivery: { description: '' } }, new AbortController().signal, capability.configurationKey), /配置已变化/)
  assert.equal(events.includes('synthesize'), false)
})

test('文档视图仅可指向相同上下文的命令，返回建议不赋予数据库写权限', async () => {
  const context = await installedAndEnabled()
  const row = context.rows.get('studio.speech')!
  row.manifest = parseExtensionManifest({ ...manifestInput(), contributes: { ...manifestInput().contributes,
    commands: [{ id: 'studio.speech.rewrite', title: '润色', contexts: ['script'] }],
    views: [{ id: 'studio.speech.panel', title: '剧本润色', location: 'script', command: 'studio.speech.rewrite' }] } })
  const document = { kind: 'script' as const, projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: '原文' }
  assert.deepEqual(await context.service.runContextCommand({ id: row.id, command: 'studio.speech.rewrite', context: document }), { title: '修改建议', text: '待审阅文本' })
  await assert.rejects(context.service.runCommand(row.id, 'studio.speech.rewrite'), /文档/)
  await assert.rejects(context.service.runContextCommand({ id: row.id, command: 'studio.speech.rewrite', context: { ...document, kind: 'draft' } }), /不适用/)
  assert.throws(() => parseExtensionManifest({ ...row.manifest, contributes: { ...row.manifest.contributes,
    views: [{ id: 'studio.speech.bad', title: '错误视图', location: 'draft', command: 'studio.speech.rewrite' }] } }))
})

test('v5 独立升级插件表，插件记录与加密凭据分表且卸载保留登记存档', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 5')
    migrateWorkbench(database, 5)
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, workbenchSchemaVersion)
    const repository = new SqliteExtensionRepository(database)
    repository.save({ id: 'studio.speech', manifest: parseExtensionManifest(manifestInput()),
      packageKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', digest: 'a'.repeat(64), enabled: false,
      installedAt: '2026-10-19T00:00:00.000Z', settings: {} })
    repository.saveSecret('studio.speech', 'api-key', new Uint8Array([1, 2, 3]))
    assert.deepEqual(repository.secretKeys('studio.speech'), ['api-key'])
    assert.equal(repository.list().length, 1)
    repository.remove('studio.speech')
    assert.deepEqual(repository.list(), [])
    assert.deepEqual(repository.secretKeys('studio.speech'), [])
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM extensions').get()?.count, 1)
    migrateWorkbench(database, workbenchSchemaVersion)
  } finally { database.close() }
})
