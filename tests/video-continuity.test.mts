import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { continuousShotInputSchema } from '../src/shared/contracts/continuity.ts'
import { videoDraftSchema, type VideoDraft } from '../src/shared/contracts/video.ts'
import { h3Sections } from '../src/shared/contracts/h3.ts'
import { GenerationService } from '../src/main/modules/jobs/application/generation-service.ts'
import { PreviewService } from '../src/main/modules/jobs/application/preview-service.ts'
import type { FinalVideoArchive, GenerationContext, GenerationRecord, GenerationGateway } from '../src/main/modules/jobs/ports/generation.ts'
import type { SubmitGeneration } from '../src/shared/contracts/generation.ts'

test('连续镜头必须绑定并实际引用视频，不能以尾帧、附件或其他编号代替', () => {
  const input = { shotContinuity: 'continuous', prompt: '<Picture 1>', references: [{ kind: 'image', label: '<Picture 1>' }] }
  assert.equal(continuousShotInputSchema.safeParse(input).success, false)
  const references = [...input.references, { kind: 'video', label: '<Video 4>' }]
  assert.equal(continuousShotInputSchema.safeParse({ ...input, references }).success, false)
  assert.equal(continuousShotInputSchema.safeParse({ ...input, references, prompt: '<Video 1>' }).success, false)
  assert.equal(continuousShotInputSchema.safeParse({ ...input, references, prompt: '从 <Video 4> 结尾之后继续' }).success, true)
  assert.equal(continuousShotInputSchema.safeParse({ ...input, shotContinuity: 'independent' }).success, true)
  assert.equal(continuousShotInputSchema.safeParse({ prompt: '', references: [] }).success, true)
})

function fixture() {
  const records = new Map<string, GenerationRecord>()
  const draft: VideoDraft = videoDraftSchema.parse({ id: randomUUID(), title: '连续性边界', description: '',
    prompt: h3Sections.map((section) => `${section}: <Picture 1>`).join('\n'), promptDocument: '', duration: 5,
    aspectRatio: '16:9', resolution: '720P', instance: 'default', instanceMode: 'manual' })
  const input: SubmitGeneration = { requestId: randomUUID(), projectId: randomUUID(), draftId: draft.id,
    workflowConfigId: randomUUID(), expectedAccountId: randomUUID(), expectedWorkflowId: '123456789012', expectedRevision: 1, confirmed: true }
  const calls = { prepare: 0, upload: 0, create: 0, tail: 0 }
  const context: GenerationContext = {
    draft: async () => structuredClone(draft),
    references: () => [{ reference: { id: randomUUID(), draftId: draft.id, assetId: randomUUID(), kind: 'image', label: '<Picture 1>', name: 'first.png', size: 8 }, path: '/managed/first.png' }],
    credential: () => 'test-only', workflow: () => ({ accountId: input.expectedAccountId, workflowId: input.expectedWorkflowId }),
    capacity: async () => ({ limit: 1, occupied: 0 })
  }
  const gateway: GenerationGateway = { inspectPreview: async () => '{}', prepare: async () => {
    calls.prepare += 1
    return { previewDefinition: '{}', upload: async () => { calls.upload += 1; return 'first.png' },
      create: async () => { calls.create += 1; return '1234567890123456789' } }
  } }
  const repository = { list: () => [...records.values()].map((record) => structuredClone(record)),
    save: (record: GenerationRecord) => { records.set(record.id, structuredClone(record)) } }
  const previews = new PreviewService(({ initial }) => ({ snapshot: () => initial, start() {}, stop() {}, cancel: async () => undefined }), () => undefined)
  const archivedAssetId = randomUUID()
  const archive: FinalVideoArchive = { save: async () => archivedAssetId, prepareContinuity: async () => {
    calls.tail += 1
    return { videoAssetId: randomUUID(), frameAssetId: randomUUID(), start: 2.166667, end: 5.166667 }
  } }
  const makeService = () => new GenerationService(repository, context, gateway, previews, () => undefined, archive)
  const service = makeService()
  function finish() {
    const record = records.get(input.requestId)!
    record.preview.remoteStatus = 'success'
    record.preview.executionSeconds = 1
    record.preview.final = { source: 'https://example.invalid/final.mp4', mime: 'video/mp4', receivedAt: new Date().toISOString() }
    record.preview.finalArchive = { status: 'ready', assetId: archivedAssetId, source: record.preview.final.source, attempts: 1 }
    records.set(record.id, record)
  }
  return { records, draft, input, calls, service, archive, makeService, finish }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test('连续预览按历史任务真实视频引用匹配前序，拒绝跨项目和多来源猜测', async () => {
  const app = fixture()
  try {
    await app.service.submit(app.input)
    app.finish()
    const source = app.records.get(app.input.requestId)!
    const videoAssetId = randomUUID()
    source.preview.continuityReference = { status: 'ready', sourceAssetId: source.preview.finalArchive!.assetId!, videoAssetId,
      frameAssetId: randomUUID(), start: 4, end: 5 }
    const next = structuredClone(source)
    next.id = randomUUID(); next.preview.id = next.id; next.preview.draftId = randomUUID()
    next.draft.id = next.preview.draftId; next.draft.shotContinuity = 'continuous'; next.draft.prompt = '从 <Video 2> 之后继续'
    next.preview.continuityReference = undefined
    next.references = [{ id: randomUUID(), draftId: next.draft.id, assetId: videoAssetId, kind: 'video', label: '<Video 2>', name: 'tail.mp4', size: 10 }]
    app.records.set(source.id, source); app.records.set(next.id, next)
    assert.equal(app.service.list().find((item) => item.id === next.id)?.continuitySourceJobId, source.id)
    source.preview.projectId = randomUUID(); app.records.set(source.id, source)
    assert.equal(app.service.list().find((item) => item.id === next.id)?.continuitySourceJobId, undefined)
    source.preview.projectId = next.preview.projectId; app.records.set(source.id, source)
    const duplicate = structuredClone(source); duplicate.id = randomUUID(); duplicate.preview.id = duplicate.id
    app.records.set(duplicate.id, duplicate)
    assert.equal(app.service.list().find((item) => item.id === next.id)?.continuitySourceJobId, undefined)
  } finally { app.service.stop() }
})

test('主进程拒绝缺少视频的连续镜头，不读取线上工作流、不上传、不付费创建', async () => {
  const app = fixture()
  app.draft.shotContinuity = 'continuous'
  await assert.rejects(app.service.submit(app.input), /连续镜头必须绑定/)
  assert.deepEqual(app.calls, { prepare: 0, upload: 0, create: 0, tail: 0 })
  assert.equal(app.records.size, 0)
})

test('出向连续属性与入向独立属性分离，归档成功后只做一次尾段处理，并按项目查询', async () => {
  const app = fixture()
  app.draft.nextTransition = 'continuous'
  await app.service.submit(app.input)
  assert.equal(app.calls.tail, 0)
  app.finish()
  app.service.restore()
  await settle()
  assert.equal(app.calls.tail, 1)
  assert.equal(app.records.get(app.input.requestId)?.preview.continuityReference?.status, 'ready')
  app.service.restore()
  await settle()
  assert.equal(app.calls.tail, 1)
  assert.equal(app.calls.create, 1)
  assert.equal(app.service.continuityReferences(app.input.projectId).length, 1)
  assert.equal(app.service.continuityReferences(randomUUID()).length, 0)
  app.service.stop()
})

test('切镜与历史草稿不会自动生成尾段', async () => {
  for (const nextTransition of [undefined, 'cut'] as const) {
    const app = fixture()
    app.draft.nextTransition = nextTransition
    await app.service.submit(app.input)
    app.finish()
    app.service.restore()
    await settle()
    assert.equal(app.calls.tail, 0)
    assert.equal(app.service.continuityReferences(app.input.projectId).length, 1)
    assert.equal(app.service.continuityReferences(app.input.projectId)[0]?.reference, null)
    app.service.stop()
  }
})

test('尾段失败不改变远端成功，不自动重试付费，手动重试仅重做尾段', async () => {
  const app = fixture()
  app.draft.nextTransition = 'continuous'
  const prepare = app.archive.prepareContinuity!
  app.archive.prepareContinuity = async () => { app.calls.tail += 1; throw new Error('模拟本地引擎缺失') }
  await app.service.submit(app.input)
  app.finish()
  app.service.restore()
  await settle()
  assert.equal(app.records.get(app.input.requestId)?.preview.remoteStatus, 'success')
  assert.equal(app.records.get(app.input.requestId)?.preview.continuityReference?.status, 'failed')
  app.service.restore()
  await settle()
  assert.equal(app.calls.tail, 1)
  app.archive.prepareContinuity = prepare
  app.service.retryFinalArchive(app.input.requestId)
  await settle()
  assert.equal(app.calls.tail, 2)
  assert.equal(app.calls.create, 1)
  assert.equal(app.records.get(app.input.requestId)?.preview.continuityReference?.status, 'ready')
  app.service.stop()
})

test('重启恢复中断的本地尾段处理，ready 素材跨重启保留不重做', async () => {
  const app = fixture()
  app.draft.nextTransition = 'continuous'
  await app.service.submit(app.input)
  app.finish()
  const record = app.records.get(app.input.requestId)!
  record.preview.continuityReference = { status: 'processing', sourceAssetId: record.preview.finalArchive!.assetId! }
  app.records.set(record.id, record)
  app.service.stop()
  const restarted = app.makeService()
  restarted.restore()
  await settle()
  assert.equal(app.calls.tail, 1)
  assert.equal(app.records.get(record.id)?.preview.continuityReference?.status, 'ready')
  restarted.restore()
  await settle()
  assert.equal(app.calls.tail, 1)
  restarted.stop()
})

test('历史任务显式补做尾段，不篡改生成快照，不上传或创建新任务，同参数复用', async () => {
  const app = fixture()
  await app.service.submit(app.input)
  app.finish()
  const original = structuredClone(app.records.get(app.input.requestId)!.draft)
  const input = { projectId: app.input.projectId, draftId: app.draft.id, jobId: app.input.requestId,
    sourceAssetId: app.records.get(app.input.requestId)!.preview.finalArchive!.assetId!, tailSeconds: 3 }
  const calls = { ...app.calls }
  const ready = await app.service.prepareContinuityReference(input)
  assert.equal(ready?.reference?.status, 'ready')
  assert.equal(ready?.sourceAssetId, input.sourceAssetId)
  assert.deepEqual(app.records.get(input.jobId)!.draft, original)
  assert.deepEqual(app.calls, { ...calls, tail: 1 })
  await app.service.prepareContinuityReference(input)
  assert.equal(app.calls.tail, 1)
  await app.service.prepareContinuityReference({ ...input, tailSeconds: 2 })
  assert.equal(app.calls.tail, 2)
  assert.equal(app.records.get(input.jobId)?.continuityRequest?.tailSeconds, 2)
  app.service.stop()
})

test('补做拒绝跨项目、错误草稿、错误源素材、无成片任务及非法时长', async () => {
  const app = fixture()
  await app.service.submit(app.input)
  const input = { projectId: app.input.projectId, draftId: app.draft.id, jobId: app.input.requestId,
    sourceAssetId: randomUUID(), tailSeconds: 3 }
  await assert.rejects(app.service.prepareContinuityReference(input), /不匹配/)
  app.finish()
  input.sourceAssetId = app.records.get(input.jobId)!.preview.finalArchive!.assetId!
  for (const invalid of [{ projectId: randomUUID() }, { draftId: randomUUID() }, { sourceAssetId: randomUUID() },
    { tailSeconds: 0 }, { tailSeconds: 6 }, { tailSeconds: 1.5 }]) {
    await assert.rejects(app.service.prepareContinuityReference({ ...input, ...invalid }))
  }
  assert.equal(app.calls.tail, 0)
  app.service.stop()
})

test('本地补做提交素材前复核授权，撤权后不得登记 ready', async () => {
  const app = fixture()
  await app.service.submit(app.input)
  app.finish()
  let allowed = true
  app.archive.prepareContinuity = async (_input, _signal, authorize) => {
    allowed = false
    authorize?.()
    throw new Error('不应到达素材登记')
  }
  const input = { projectId: app.input.projectId, draftId: app.draft.id, jobId: app.input.requestId,
    sourceAssetId: app.records.get(app.input.requestId)!.preview.finalArchive!.assetId!, tailSeconds: 3 }
  await assert.rejects(app.service.prepareContinuityReference(input, () => { if (!allowed) throw new Error('已撤权') }), /已撤权/)
  assert.equal(app.records.get(input.jobId)?.preview.continuityReference?.status, 'failed')
  assert.equal(app.records.get(input.jobId)?.preview.remoteStatus, 'success')
  app.service.stop()
})
