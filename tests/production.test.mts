import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteProductionRepository } from '../src/main/infrastructure/database/production-repository.ts'
import { SqliteAssetRepository } from '../src/main/infrastructure/database/asset-repository.ts'
import { ProductionService } from '../src/main/modules/production/application/production-service.ts'
import { LibraryService } from '../src/main/modules/assets/application/library-service.ts'
import { inspectPcmWave } from '../src/main/modules/production/domain/audio.ts'
import { dialoguePlanSchema, type DialoguePlan, type DialogueTake } from '../src/shared/contracts/production.ts'
import type { SpeechAudio, SpeechCapability } from '../src/shared/contracts/extensions.ts'
import type { ProductionSpeech } from '../src/main/modules/production/ports/production.ts'

function wave(): SpeechAudio {
  const audio = new Uint8Array(16044)
  const view = new DataView(audio.buffer)
  const ascii = (offset: number, text: string) => audio.set(new TextEncoder().encode(text), offset)
  ascii(0, 'RIFF'); view.setUint32(4, audio.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 16000, true); view.setInt16(44, 100, true)
  return { audio, format: 'wav', durationMs: 1000, sampleRate: 8000 }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

function setup() {
  const database = new WorkbenchDatabase(':memory:')
  const db = database.connection
  const scope = { projectId: randomUUID(), draftId: randomUUID() }
  db.prepare('INSERT INTO projects VALUES (?, ?, 0, 0)').run(scope.projectId, '测试项目')
  db.prepare('INSERT INTO video_drafts VALUES (?, ?, 0, ?)').run(scope.draftId, scope.projectId, '{}')
  const repository = new SqliteProductionRepository(db)
  const capability: SpeechCapability = { extensionId: 'studio.speech', extensionName: '测试引擎', version: '1.0.0', configurationKey: 'configuration-1', settings: {},
    available: true, reason: null, provider: { id: 'studio.speech.cpu', name: 'CPU', runtime: 'local', maxTextLength: 120,
      capabilities: { presetVoices: true, voiceCloning: false, emotion: false } } }
  let calls = 0
  let prompt = '输入快照'
  const speech: ProductionSpeech = { speechCapabilities: () => [capability], synthesize: async () => { calls++; return wave() } }
  const staged = new Set<string>()
  const library = new LibraryService(new SqliteAssetRepository(db), {
    resolve: (name) => name, reveal: () => undefined, discard: async () => undefined,
    importImage: async () => { throw new Error('台词测试不导入图片') },
    import: async (id, path) => { assert.ok(staged.has(path)); return { storedName: `${id}.wav`, name: 'audio.wav', size: 16044 } }
  }, randomUUID)
  const context = { scopes: async () => [scope], draft: async () => ({ prompt }) }
  const files = { stage: async (id: string) => { staged.add(id); return id }, discard: async (id: string) => { staged.delete(id) } }
  const productionLibrary = {
    importAudio: async (input: typeof scope, path: string, _name: string, notes: string) => (await library.import({ projectId: input.projectId, categoryId: null, kind: 'audio', tags: [], prompt: '', notes }, [path]))[0]!.id,
    ensureAudio: (id: string) => { assert.equal(library.get(id).kind, 'audio') }
  }
  const service = new ProductionService(repository, speech, context, files, productionLibrary, randomUUID)
  const line = { id: randomUUID(), character: '角色甲', text: '你好', delivery: '', speed: 1, language: 'zh', startMs: 500,
    extensionId: 'studio.speech', providerId: 'studio.speech.cpu', voiceId: '45' }
  const plan: DialoguePlan = { ...scope, revision: 0, enabled: true, lines: [line] }
  async function finished(id: string) {
    for (let index = 0; index < 100; index++) {
      const take = repository.takes(scope).find((item) => item.id === id)
      if (take && !['queued', 'running', 'cancelling'].includes(take.status)) return take
      await turn()
    }
    throw new Error('fixture task did not finish')
  }
  return { database, db, repository, scope, capability, speech, service, library, line, plan, finished, files, context, productionLibrary,
    calls: () => calls, setPrompt: (value: string) => { prompt = value } }
}

test('台词配置 CAS 保存、重复 ID 拒绝，读取配置不自动生成', async () => {
  const app = setup()
  try {
    assert.equal((await app.service.load(app.scope)).plan.revision, 0)
    const saved = await app.service.save(app.plan)
    assert.equal(saved.revision, 1)
    await assert.rejects(app.service.save(app.plan), /更新/)
    assert.equal(app.calls(), 0)
    assert.throws(() => dialoguePlanSchema.parse({ ...app.plan, lines: [app.line, app.line] }))
  } finally { app.service.stop(); app.database.close() }
})

test('真实 SQLite 候选入库、多次生成不覆盖，采用只影响当前句', async () => {
  const app = setup()
  try {
    const plan = await app.service.save(app.plan)
    const first = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id })
    const done = await app.finished(first.id)
    assert.equal(done.status, 'succeeded'); assert.equal(done.durationMs, 1000)
    assert.equal(app.library.get(done.assetId!).kind, 'audio')
    await app.service.adopt({ ...app.scope, revision: plan.revision, takeId: done.id })
    const second = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id })
    await app.finished(second.id)
    await app.service.adopt({ ...app.scope, revision: plan.revision, takeId: second.id })
    assert.equal(app.repository.takes(app.scope).length, 2)
    assert.equal(app.repository.takes(app.scope).find((take) => take.id === first.id)?.adopted, false)
    assert.equal(app.repository.takes(app.scope).find((take) => take.id === second.id)?.adopted, true)
    assert.throws(() => app.library.remove(done.assetId!), /引用/)
  } finally { app.service.stop(); app.database.close() }
})

test('未支持语气、超过引擎字数、停用步骤均不提交推理', async () => {
  const app = setup()
  try {
    let plan = await app.service.save({ ...app.plan, lines: [{ ...app.line, delivery: '愤怒' }] })
    await assert.rejects(app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id }), /语气/)
    plan = await app.service.save({ ...plan, lines: [{ ...app.line, text: '字'.repeat(121) }] })
    await assert.rejects(app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id }), /长度/)
    plan = await app.service.save({ ...plan, enabled: false, lines: [app.line] })
    await assert.rejects(app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id }), /启用/)
    assert.equal(app.calls(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('输入修订、提示词或插件配置变化后不能采用旧候选', async () => {
  const app = setup()
  try {
    const plan = await app.service.save(app.plan)
    const job = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id })
    await app.finished(job.id)
    app.setPrompt('新提示词')
    await assert.rejects(app.service.adopt({ ...app.scope, revision: plan.revision, takeId: job.id }), /旧版/)
    app.setPrompt('输入快照'); app.capability.configurationKey = 'configuration-2'
    await assert.rejects(app.service.adopt({ ...app.scope, revision: plan.revision, takeId: job.id }), /配置/)
    app.capability.configurationKey = 'configuration-1'
    const next = await app.service.save({ ...plan, lines: [{ ...app.line, text: '新台词' }] })
    await assert.rejects(app.service.adopt({ ...app.scope, revision: next.revision, takeId: job.id }), /旧版/)
    assert.equal(app.repository.takes(app.scope).length, 1)
  } finally { app.service.stop(); app.database.close() }
})

test('语音全局单路；重复句阻断；排队取消不调用模型，运行取消不自动重试', async () => {
  const app = setup()
  try {
    let started = 0
    app.speech.synthesize = async (_id, _provider, _request, signal) => {
      started++
      return new Promise<SpeechAudio>((_resolve, reject) => {
        const abort = () => reject(new Error('cancelled'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
    const secondLine = { ...app.line, id: randomUUID(), text: '第二句' }
    const plan = await app.service.save({ ...app.plan, lines: [app.line, secondLine] })
    const first = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id })
    await turn()
    await assert.rejects(app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id }), /待完成/)
    const second = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: secondLine.id })
    assert.equal(started, 1)
    await app.service.cancel({ ...app.scope, takeId: second.id })
    assert.equal((await app.finished(second.id)).status, 'cancelled')
    await app.service.cancel({ ...app.scope, takeId: first.id })
    assert.equal((await app.finished(first.id)).status, 'cancelled')
    await turn(); assert.equal(started, 1)
  } finally { app.service.stop(); app.database.close() }
})

test('项目角色音色持久化并独立校验修订，不改写已保存台词', async () => {
  const app = setup()
  try {
    const { character, extensionId, providerId, voiceId, language, speed } = app.line
    const binding = { character, extensionId, providerId, voiceId, language, speed }
    const voices = await app.service.saveCharacterVoice({ ...app.scope, revision: 0, binding })
    assert.equal(voices.revision, 1)
    await assert.rejects(app.service.saveCharacterVoice({ ...app.scope, revision: 0, binding }), /更新/)
    assert.equal((await app.service.load(app.scope)).voices.bindings[0]?.voiceId, '45')
    assert.equal((await app.service.load(app.scope)).plan.lines.length, 0)
  } finally { app.service.stop(); app.database.close() }
})

test('音频已完成、清理暂存期间到达的取消不把结果卡在取消中', async () => {
  const app = setup()
  let finishCleanup: (() => void) | undefined
  try {
    app.files.discard = async () => new Promise<void>((resolve) => { finishCleanup = resolve })
    const plan = await app.service.save(app.plan)
    const take = await app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id })
    await turn()
    assert.ok(finishCleanup)
    await app.service.cancel({ ...app.scope, takeId: take.id })
    finishCleanup()
    assert.equal((await app.finished(take.id)).status, 'succeeded')
  } finally { finishCleanup?.(); app.service.stop(); await turn(); app.database.close() }
})

test('云端必须由主进程明确确认当前配置；排队期间换配置不会改用新配置推理', async () => {
  const app = setup()
  let release: (() => void) | undefined
  try {
    app.capability.provider.runtime = 'cloud'
    const plan = await app.service.save(app.plan)
    await assert.rejects(app.service.generate({ ...app.scope, revision: plan.revision, lineId: app.line.id }), /确认/)
    assert.equal(app.calls(), 0)
    app.capability.provider.runtime = 'local'
    let started = 0
    app.speech.synthesize = async () => {
      started++
      await new Promise<void>((resolve) => { release = resolve })
      return wave()
    }
    const second = { ...app.line, id: randomUUID(), text: '第二句' }
    const next = await app.service.save({ ...plan, lines: [app.line, second] })
    const firstTake = await app.service.generate({ ...app.scope, revision: next.revision, lineId: app.line.id })
    await turn()
    const queuedTake = await app.service.generate({ ...app.scope, revision: next.revision, lineId: second.id })
    app.capability.configurationKey = 'changed-while-queued'
    release?.()
    await app.finished(firstTake.id)
    assert.equal((await app.finished(queuedTake.id)).status, 'failed')
    assert.equal(started, 1)
  } finally { release?.(); app.service.stop(); await turn(); app.database.close() }
})

test('重启中断待处理任务，不重提模型；软删除作用域不能重新保存', async () => {
  const app = setup()
  try {
    const plan = await app.service.save(app.plan)
    const take: DialogueTake = { ...app.scope, id: randomUUID(), planRevision: plan.revision, line: app.line, sourcePrompt: '输入快照',
      providerVersion: '1.0.0', configurationKey: 'configuration-1', providerSettings: {}, runtime: 'cloud', status: 'running',
      createdAt: new Date().toISOString(), finishedAt: null, error: null, assetId: null, durationMs: null, adopted: false }
    app.repository.saveTake(take)
    const restarted = new ProductionService(app.repository, app.speech, app.context, app.files, app.productionLibrary, randomUUID)
    assert.equal(app.repository.takes(app.scope)[0]?.status, 'interrupted')
    assert.equal(app.calls(), 0)
    restarted.stop()
    app.db.prepare('INSERT INTO workspace_trash VALUES (?, ?, ?, ?, ?)').run(app.scope.draftId, 'video', app.scope.projectId, '{}', new Date().toISOString())
    await assert.rejects(app.service.save(plan), /删除/)
    assert.equal((await app.service.listTasks()).length, 0)
  } finally { app.service.stop(); app.database.close() }
})

test('WAV 块边界、采样格式与音频元数据读取', () => {
  const valid = wave().audio
  assert.deepEqual(inspectPcmWave(valid), { durationMs: 1000, sampleRate: 8000 })
  assert.throws(() => inspectPcmWave(valid.subarray(0, 100)))
  const damaged = valid.slice(); new DataView(damaged.buffer).setUint16(34, 32, true)
  assert.throws(() => inspectPcmWave(damaged))
})
