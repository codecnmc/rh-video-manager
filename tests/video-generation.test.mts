import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { GenerationService } from '../src/main/modules/jobs/application/generation-service.ts'
import { PreviewService } from '../src/main/modules/jobs/application/preview-service.ts'
import type { GenerationContext, GenerationRecord, GenerationGateway } from '../src/main/modules/jobs/ports/generation.ts'
import { GenerationRejectedError } from '../src/main/modules/jobs/ports/generation.ts'
import { prepareH3Graph, RunningHubGenerationGateway } from '../src/main/providers/runninghub/generation-gateway.ts'
import type { VideoDraft } from '../src/shared/contracts/video.ts'
import type { SubmitGeneration } from '../src/shared/contracts/generation.ts'
import { h3Sections } from '../src/shared/contracts/h3.ts'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteGenerationRepository } from '../src/main/infrastructure/database/generation-repository.ts'
import { ManagedSamplingFiles } from '../src/main/infrastructure/files/sampling-files.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskConsumption } from '../src/main/providers/runninghub/task-consumption.ts'

const prompt = h3Sections.map((section) => `${section}: <Picture 4>`).join('\n')
const draft: VideoDraft = { id: randomUUID(), title: '协议测试', description: '', prompt, promptDocument: '',
  duration: 8, aspectRatio: '9:16', resolution: '720P', instance: 'plus', instanceMode: 'auto' }
const graph = {
  'new-h3-id': { class_type: 'FeiHouEasyH3RH', inputs: { mode: 'Reference-to-video', prompt: 'old', seconds: 12,
    resolution: '720P', aspect_ratio: '16:9', reference_mention_mode: 'By index', prompt_optimizer_enabled: true,
    embedded_media_json: 'old', media_1: 'old.png', audio_duration_auto: 'Off' } },
  'upstream': { class_type: 'VAEDecode', inputs: {} },
  'notify': { class_type: 'Notif-Webhook', inputs: { any: ['upstream', 0], webhook_url: 'NOT-A-REAL-NOTIFICATION' } },
  'preview': { class_type: 'ModelPreviewOverrideKJ', inputs: {} },
  'final': { class_type: 'VHS_VideoCombine', inputs: { images: ['notify', 0], save_output: true,
    filename_prefix: 'test_Minimax_H3_Upscale_', format: 'video/h264-mp4' } },
  'canvas': { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '16:9 (Widescreen)', megapixels: 1.5, multiple: 32 } }
}
const response = () => ({ code: 0, data: { prompt: JSON.stringify(graph) } })

test('按线上类型定位 H3，绑定参数和二采画幅，旁路通知，不修改原图', () => {
  const plan = prepareH3Graph(response(), draft)
  assert.equal(plan.nodeId, 'new-h3-id')
  assert.equal(plan.graph['new-h3-id']?.inputs.prompt, prompt)
  assert.equal(plan.graph['new-h3-id']?.inputs.seconds, 8)
  assert.equal(plan.graph['new-h3-id']?.inputs.media_1, '')
  assert.equal(plan.graph['new-h3-id']?.inputs.prompt_optimizer_enabled, false)
  assert.equal(plan.graph['canvas']?.inputs.aspect_ratio, '9:16 (Portrait Widescreen)')
  assert.equal(plan.graph['notify'], undefined)
  assert.deepEqual(plan.graph['final']?.inputs.images, ['upstream', 0])
  assert.equal(graph['new-h3-id'].inputs.prompt, 'old')
  assert.deepEqual(JSON.parse(plan.previewDefinition).samplingNodes, ['preview'])
})

test('多主节点、外部输入和非全能参考模式在付费前拒绝', () => {
  const duplicate = { ...graph, duplicate: graph['new-h3-id'] }
  assert.throws(() => prepareH3Graph({ code: 0, data: { prompt: JSON.stringify(duplicate) } }, draft), /一个/)
  const linked = structuredClone(graph)
  Object.assign(linked['new-h3-id'].inputs, { seconds: ['external', 0] })
  assert.throws(() => prepareH3Graph({ code: 0, data: { prompt: JSON.stringify(linked) } }, draft), /类型/)
  const imageMode = structuredClone(graph)
  imageMode['new-h3-id'].inputs.mode = 'Image-to-video'
  assert.throws(() => prepareH3Graph({ code: 0, data: { prompt: JSON.stringify(imageMode) } }, draft), /全能参考/)
})

test('创建使用本次线上副本和实际 instanceType，引用连续化，不附带额外计费或通知', async () => {
  const original = globalThis.fetch
  const requests: { path: string; body: unknown }[] = []
  globalThis.fetch = async (url, init) => {
    requests.push({ path: String(url), body: JSON.parse(String(init?.body)) as unknown })
    return new Response(JSON.stringify(String(url).endsWith('getJsonApiFormat') ? response() : { code: 0, data: { taskId: '1234567890123456789' } }))
  }
  try {
    const plan = await new RunningHubGenerationGateway().prepare('123456789012', 'test-only-key', draft)
    const taskId = await plan.create([{ reference: { id: randomUUID(), draftId: draft.id, assetId: randomUUID(), kind: 'image', label: '<Picture 4>', name: 'four.png', size: 8 }, filename: 'openapi/four.png' }])
    assert.equal(taskId, '1234567890123456789')
    const body = requests[1]?.body as { workflow: string; instanceType: string; retainSeconds?: number; webhookUrl?: string }
    assert.equal(body.instanceType, 'plus')
    assert.equal(body.retainSeconds, undefined)
    assert.equal(body.webhookUrl, undefined)
    const submitted = JSON.parse(body.workflow) as typeof graph
    assert.equal(submitted['new-h3-id'].inputs.prompt.includes('<Picture 1>'), true)
    assert.equal(submitted['new-h3-id'].inputs.prompt.includes('<Picture 4>'), false)
    assert.deepEqual(JSON.parse(submitted['new-h3-id'].inputs.embedded_media_json), [{ filename: 'openapi/four.png', media_type: 'image', audio_trim: '' }])
    assert.equal('notify' in submitted, false)
  } finally { globalThis.fetch = original }
})

function setup() {
  const records = new Map<string, GenerationRecord>()
  const accountId = randomUUID()
  const input: SubmitGeneration = { requestId: randomUUID(), projectId: randomUUID(), draftId: draft.id,
    workflowConfigId: randomUUID(), expectedAccountId: accountId, expectedWorkflowId: '123456789012', expectedRevision: 1, confirmed: true }
  let creates = 0
  let restored = 0
  const context: GenerationContext = {
    draft: async () => draft,
    references: () => [{ reference: { id: randomUUID(), draftId: draft.id, assetId: randomUUID(), kind: 'image', label: '<Picture 4>', name: 'image.png', size: 8 }, path: '/managed/image.png' }],
    workflow: () => ({ accountId, workflowId: '123456789012' }), credential: () => 'test-only-key',
    capacity: async () => ({ limit: 1, occupied: 0 })
  }
  const gateway: GenerationGateway = { inspectPreview: async () => '{}', prepare: async () => ({ previewDefinition: '{}', upload: async () => 'openapi/image.png',
    create: async () => { creates += 1; return '1234567890123456789' } }) }
  const previews = new PreviewService(({ initial }) => ({ snapshot: () => initial,
    start: () => { restored += 1 }, stop: () => undefined, cancel: async () => undefined }), () => undefined)
  const repository = { list: () => [...records.values()].map((record) => structuredClone(record)),
    save: (record: GenerationRecord) => { records.set(record.id, structuredClone(record)) } }
  const service = new GenerationService(repository, context, gateway, previews, () => undefined)
  return { input, service, context, gateway, records, previews, repository, get creates() { return creates }, get restored() { return restored } }
}

test('消费补查使用原账号，只更新费用，不重提、不恢复监听或覆盖任务终态', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const record = app.records.get(initial.id)!
  record.preview.remoteStatus = 'success'
  record.preview.connection = 'completed'
  app.records.set(record.id, record)
  const before = structuredClone(record)
  const restored = app.restored
  app.context.credential = (id) => { assert.equal(id, initial.accountId); return 'original-account-key' }
  app.gateway.queryConsumption = async (taskId, credential) => {
    assert.equal(taskId, initial.taskId)
    assert.equal(credential, 'original-account-key')
    return parseTaskConsumption([{ chargedPoint: '17' }])
  }
  await app.service.refreshConsumption(initial.id)
  const saved = app.records.get(initial.id)!
  assert.equal(saved.preview.consumption?.points, '17')
  const { consumption: _consumption, ...preview } = saved.preview
  assert.deepEqual(preview, before.preview)
  assert.equal(app.creates, 1)
  assert.equal(app.restored, restored)
  app.gateway.queryConsumption = async () => { throw new Error('接口已停用') }
  await assert.rejects(app.service.refreshConsumption(initial.id), /接口已停用/)
  assert.equal(app.records.get(initial.id)!.preview.consumption?.points, '17')
})

test('消费明细只汇总成功任务，保留未知与零，支持去重和项目账号日期筛选', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const first = app.records.get(initial.id)!
  first.createdAt = '2026-11-04T00:00:00.000Z'
  first.preview.submittedAt = first.createdAt
  first.preview.remoteStatus = 'success'
  first.preview.consumption = parseTaskConsumption([{ chargedPoint: '0.1' }])
  app.records.set(first.id, first)
  for (const [index, coins] of ['0.2', '0', null].entries()) {
    const row = structuredClone(first)
    row.id = randomUUID()
    row.preview.id = row.id
    row.preview.taskId = `123456789012345679${index}`
    row.preview.consumption = coins === null ? undefined : parseTaskConsumption([{ chargedPoint: coins }])
    app.records.set(row.id, row)
  }
  const duplicate = { ...structuredClone(first), id: randomUUID() }
  app.records.set(duplicate.id, duplicate)
  for (const [index, status] of (['failed', 'cancelled', 'unknown', 'queued', 'running'] as const).entries()) {
    const excluded = structuredClone(first)
    excluded.id = randomUUID()
    excluded.preview.id = excluded.id
    excluded.preview.taskId = `123456789012345680${index}`
    excluded.preview.remoteStatus = status
    excluded.preview.consumption = parseTaskConsumption([{ chargedPoint: '10000' }])
    app.records.set(excluded.id, excluded)
  }
  const ledger = app.service.consumptionLedger({ projectId: app.input.projectId, accountId: app.input.expectedAccountId,
    from: '2026-11-04T00:00:00.000Z', to: '2026-11-04T23:59:59.999Z' })
  assert.equal(ledger.entries.length, 4)
  assert.equal(ledger.knownPoints, '0.3')
  assert.equal(ledger.knownCount, 3)
  assert.equal(ledger.unknownCount, 1)
  assert.ok(ledger.entries.every((entry) => entry.remoteStatus === 'success'))
  assert.equal(app.service.consumptionLedger({ accountId: randomUUID() }).entries.length, 0)
  assert.equal(app.service.consumptionLedger({ from: '2026-11-05T00:00:00.000Z' }).knownPoints, null)
})

test('生成中及快照暂停时不能补查费用，补查中禁止快照复制并去重请求', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  await assert.rejects(app.service.refreshConsumption(initial.id), /生成成功/)
  const row = app.records.get(initial.id)!
  row.preview.remoteStatus = 'success'
  app.records.set(row.id, row)
  const resume = app.service.pauseForSnapshot()
  await assert.rejects(app.service.refreshConsumption(initial.id), /导出/)
  resume()
  let resolveQuery!: (value: ReturnType<typeof parseTaskConsumption>) => void
  app.gateway.queryConsumption = () => new Promise((resolve) => { resolveQuery = resolve })
  const query = app.service.refreshConsumption(initial.id)
  assert.throws(() => app.service.pauseForSnapshot(), /请完成后再导出/)
  await assert.rejects(app.service.refreshConsumption(initial.id), /正在补查/)
  resolveQuery(parseTaskConsumption([{ chargedPoint: '0' }]))
  await query
  assert.equal(app.service.hasLocalStorageActivity(), false)
})

test('所有非成功任务拒绝补查，不查询账号凭据或远端费用', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  let queries = 0
  let credentials = 0
  app.gateway.queryConsumption = async () => { queries += 1; return parseTaskConsumption([{ chargedPoint: '17' }]) }
  app.context.credential = () => { credentials += 1; return 'test-only-key' }
  for (const status of ['failed', 'cancelled', 'unknown', 'queued', 'running'] as const) {
    const row = app.records.get(initial.id)!
    row.preview.remoteStatus = status
    app.records.set(row.id, row)
    await assert.rejects(app.service.refreshConsumption(initial.id), /生成成功/)
  }
  assert.equal(queries, 0)
  assert.equal(credentials, 0)
  assert.equal(app.creates, 1)
})

test('待确认历史不影响退出，但仍保留占位和未结束判断', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const record = app.records.get(initial.id)!
  for (const status of ['unknown', 'queued', 'running'] as const) {
    record.preview.remoteStatus = status
    record.preview.connection = 'connected'
    record.preview.cancelState = 'none'
    app.records.set(record.id, structuredClone(record))
    assert.equal(app.service.hasCloseActivity(), status !== 'unknown')
    assert.equal(app.service.hasPending(), true)
    assert.equal(app.service.hasStorageActivity(), true)
    record.preview.connection = 'disconnected'
    app.records.set(record.id, structuredClone(record))
    assert.equal(app.service.hasCloseActivity(), false)
    record.preview.connection = 'connected'
    for (const cancelState of ['requested', 'uncertain'] as const) {
      record.preview.cancelState = cancelState
      app.records.set(record.id, structuredClone(record))
      assert.equal(app.service.hasCloseActivity(), false)
    }
  }
})

test('消费明细使用提交时视频秒数和平台运行秒数，不从时间差猜测', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const record = app.records.get(initial.id)!
  record.preview.remoteStatus = 'success'
  record.preview.requestedDuration = 12
  record.preview.executionSeconds = 320.5
  app.records.set(record.id, structuredClone(record))
  assert.equal(app.service.consumptionLedger({}).entries[0]?.videoSeconds, 12)
  assert.equal(app.service.consumptionLedger({}).entries[0]?.executionSeconds, 320.5)
  delete record.preview.requestedDuration
  delete record.preview.executionSeconds
  app.records.set(record.id, structuredClone(record))
  assert.equal(app.service.consumptionLedger({}).entries[0]?.videoSeconds, record.draft.duration)
  assert.equal(app.service.consumptionLedger({}).entries[0]?.executionSeconds, null)
})

test('费用查询返回前成功状态已变化时拒绝保存', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const row = app.records.get(initial.id)!
  row.preview.remoteStatus = 'success'
  app.records.set(row.id, row)
  app.gateway.queryConsumption = async () => {
    const changed = app.records.get(initial.id)!
    changed.preview.remoteStatus = 'failed'
    app.records.set(changed.id, changed)
    return parseTaskConsumption([{ chargedPoint: '17' }])
  }
  await assert.rejects(app.service.refreshConsumption(initial.id), /任务记录已变化/)
  assert.equal(app.records.get(initial.id)!.preview.consumption, undefined)
})

test('远端未结束任务可做快照，暂停期间不落盘，恢复后应用最新状态且不重提', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  assert.equal(app.service.hasStorageActivity(), true)
  assert.equal(app.service.hasLocalStorageActivity(), false)
  const resume = app.service.pauseForSnapshot()
  const { sampling: _sampling, draft: _draft, final: _final, ...state } = initial
  app.service.onPreview({ type: 'state', state: { ...state, remoteStatus: 'running' } })
  app.service.onPreview({ type: 'state', state: { ...state, remoteStatus: 'success' } })
  assert.equal(app.records.get(initial.id)?.preview.remoteStatus, initial.remoteStatus)
  resume()
  assert.equal(app.records.get(initial.id)?.preview.remoteStatus, 'success')
  assert.equal(app.creates, 1)
})

test('人工确认取消保留远端状态并留痕，不重新创建或恢复监听', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const record = app.records.get(initial.id)!
  record.preview.remoteStatus = 'unknown'
  record.preview.cancelState = 'requested'
  app.records.set(record.id, record)
  const confirmed = app.service.confirmCancellation({ id: initial.id, expectedTaskId: initial.taskId, confirmed: true })
  assert.equal(confirmed.remoteStatus, 'unknown')
  assert.equal(confirmed.cancelState, 'requested')
  assert.ok(confirmed.manualCancellationConfirmedAt)
  assert.ok(confirmed.localReservationReleasedAt)
  assert.equal(app.previews.list().length, 0)
  assert.equal(app.service.hasPending(app.input.projectId), false)
  const restored = app.restored
  app.service.restore(); app.service.resume()
  assert.equal(app.restored, restored)
  assert.equal(app.creates, 1)
  const { sampling: _sampling, draft: _draft, final: _final, ...state } = initial
  app.service.onPreview({ type: 'state', state })
  assert.equal(app.records.get(initial.id)?.preview.manualCancellationConfirmedAt, confirmed.manualCancellationConfirmedAt)
})

test('人工确认拒绝过期任务 ID、明确运行任务和真实终态', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  assert.throws(() => app.service.confirmCancellation({ id: initial.id, expectedTaskId: '999999999999999999', confirmed: true }), /状态已变化/)
  const record = app.records.get(initial.id)!
  record.preview.remoteStatus = 'running'; record.preview.connection = 'connected'
  app.records.set(record.id, record)
  assert.throws(() => app.service.confirmCancellation({ id: initial.id, expectedTaskId: initial.taskId, confirmed: true }), /先请求取消/)
  record.preview.remoteStatus = 'success'
  app.records.set(record.id, record)
  assert.throws(() => app.service.confirmCancellation({ id: initial.id, expectedTaskId: initial.taskId, confirmed: true }), /状态已变化/)
  assert.equal(app.creates, 1)
})

test('上传前落库、成功自动监听、同标识不重复创建，未完成草稿阻止新提交', async () => {
  const app = setup()
  const result = await app.service.submit(app.input)
  assert.equal(result.taskId, '1234567890123456789')
  assert.equal(result.requestedDuration, 8)
  assert.ok(result.submittedAt)
  assert.equal(app.records.get(app.input.requestId)?.phase, 'accepted')
  assert.equal(app.restored, 1)
  assert.equal((await app.service.submit(app.input)).taskId, result.taskId)
  assert.equal(app.creates, 1)
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID() }), /未完成/)
})

test('手动解除本地占位须匹配任务，保留远端状态、监听和审计，平台满额仍拒绝创建', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const input = { id: initial.id, expectedTaskId: initial.taskId, confirmed: true as const }
  assert.throws(() => app.service.releaseReservation({ ...input, expectedTaskId: '9999999999999999999' }), /状态已变化/)
  const record = app.records.get(initial.id)!
  record.preview.connection = 'connected'
  app.records.set(record.id, record)
  assert.throws(() => app.service.releaseReservation(input), /仅允许/)
  record.preview.cancelState = 'requested'
  app.records.set(record.id, record)
  const released = app.service.releaseReservation(input)
  assert.ok(released.localReservationReleasedAt)
  assert.equal(released.remoteStatus, initial.remoteStatus)
  assert.equal(released.cancelState, 'requested')
  assert.equal(app.service.releaseReservation(input).localReservationReleasedAt, released.localReservationReleasedAt)
  const { sampling: _sampling, draft: _draft, final: _final, ...state } = initial
  app.service.onPreview({ type: 'state', state })
  assert.equal(app.records.get(initial.id)!.preview.localReservationReleasedAt, released.localReservationReleasedAt)
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), true)
  assert.equal(app.restored, 1)
  app.context.capacity = async () => ({ limit: 1, occupied: 1 })
  const blocked = await app.service.submit({ ...app.input, requestId: randomUUID() })
  assert.equal(blocked.remoteStatus, 'failed')
  assert.equal(app.creates, 1)
})

test('取消受理自动解除本地占位，保留远端状态与保护，随后可直接重新提交', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const { sampling: _sampling, draft: _draft, final: _final, ...state } = initial
  const acceptedAt = '2026-10-29T08:00:00.000Z'
  const event = app.service.onPreview({ type: 'state', state: { ...state, cancelState: 'requested', cancelRequestedAt: acceptedAt } })
  assert.equal(event.type, 'state')
  if (event.type === 'state') assert.equal(event.state.localReservationReleasedAt, acceptedAt)
  const saved = app.records.get(initial.id)!.preview
  assert.equal(saved.localReservationReleasedAt, acceptedAt)
  assert.equal(saved.remoteStatus, initial.remoteStatus)
  assert.equal(saved.manualCancellationConfirmedAt, undefined)
  assert.equal(saved.completedAt, undefined)
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), true)
  app.service.onPreview({ type: 'state', state: { ...state, cancelState: 'requested' } })
  assert.equal(app.records.get(initial.id)!.preview.localReservationReleasedAt, acceptedAt)
  await app.service.submit({ ...app.input, requestId: randomUUID() })
  assert.equal(app.creates, 2)
})

for (const cancelState of ['requesting', 'rejected', 'uncertain'] as const) {
  test(`取消状态 ${cancelState} 不自动解除本地占位`, async () => {
    const app = setup()
    const initial = await app.service.submit(app.input)
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = initial
    app.service.onPreview({ type: 'state', state: { ...state, cancelState } })
    assert.equal(app.records.get(initial.id)!.preview.localReservationReleasedAt, undefined)
    await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID() }), /未完成/)
    assert.equal(app.creates, 1)
  })
}

test('恢复历史取消回执自动解除占位并保留监听，平台满额仍拒绝创建', async () => {
  const app = setup()
  const initial = await app.service.submit(app.input)
  const record = app.records.get(initial.id)!
  record.preview.cancelState = 'requested'
  app.records.set(record.id, record)
  app.previews.disconnect(initial.id)
  app.service.restore()
  const releasedAt = app.records.get(initial.id)!.preview.localReservationReleasedAt
  assert.ok(releasedAt)
  assert.equal(app.restored, 2)
  assert.equal(app.creates, 1)
  app.service.restore()
  assert.equal(app.records.get(initial.id)!.preview.localReservationReleasedAt, releasedAt)
  app.context.capacity = async () => ({ limit: 1, occupied: 1 })
  const blocked = await app.service.submit({ ...app.input, requestId: randomUUID() })
  assert.equal(blocked.remoteStatus, 'failed')
  assert.equal(app.creates, 1)
})

test('取消回执仍保留删除等可靠性保护，已确认取消后解除且恢复不再监听', async () => {
  const app = setup()
  await app.service.submit(app.input)
  const record = app.records.get(app.input.requestId)!
  record.preview.cancelState = 'requested'
  app.records.set(record.id, record)
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), true)
  record.preview.remoteStatus = 'cancelled'
  record.preview.connection = 'completed'
  record.preview.completedAt = new Date().toISOString()
  app.records.set(record.id, record)
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), false)
  const before = app.restored
  app.service.restore()
  assert.equal(app.restored, before)
  assert.equal(app.creates, 1)
})

test('手动确认旧任务后可重新生成，保留旧状态和采样且重复请求不再次创建', async () => {
  const app = setup()
  await app.service.submit(app.input)
  const old = app.records.get(app.input.requestId)!
  old.preview.remoteStatus = 'unknown'
  old.preview.cancelState = 'requested'
  old.preview.sampling = { source: 'https://rh-images.xiaoyaoyou.com/sample.jpg', mime: 'image/jpeg', receivedAt: new Date().toISOString() }
  app.records.set(old.id, old)
  const original = structuredClone(old)
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID() }), /未完成/)
  const input: SubmitGeneration = { ...app.input, requestId: randomUUID(), replacement: { taskIds: [old.id], confirmed: true } }
  const result = await app.service.submit(input)
  assert.ok(result.taskId)
  assert.equal(app.creates, 2)
  assert.deepEqual(app.records.get(old.id), original)
  const replacement = app.records.get(input.requestId)!
  assert.deepEqual(replacement.replacedTaskIds, [old.id])
  assert.ok(replacement.regenerationConfirmedAt)
  await app.service.submit(input)
  assert.equal(app.creates, 2)
  // 旧任务未知状态仍保留项目删除等可靠性保护，不伪装为远端已取消。
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), true)
})

test('自动调度传递重生成确认并在两次平台容量检查后仅创建一次', async () => {
  const app = setup()
  await app.service.submit(app.input)
  app.context.routes = () => [{ configId: app.input.workflowConfigId, accountId: app.input.expectedAccountId, workflowId: app.input.expectedWorkflowId }]
  let capacityChecks = 0
  app.context.capacity = async () => { capacityChecks += 1; return { limit: 1, occupied: 0 } }
  const result = await app.service.schedule({ requestId: randomUUID(), projectId: app.input.projectId, draftId: app.input.draftId,
    expectedRevision: 1, confirmed: true, replacement: { taskIds: [app.input.requestId], confirmed: true } })
  assert.ok(result.taskId)
  assert.equal(capacityChecks, 3)
  assert.equal(app.creates, 2)
})

test('重生成确认不能绕过平台实际并发或其他草稿的本地预留', async () => {
  const app = setup()
  await app.service.submit(app.input)
  app.context.capacity = async () => ({ limit: 1, occupied: 1 })
  const input: SubmitGeneration = { ...app.input, requestId: randomUUID(), replacement: { taskIds: [app.input.requestId], confirmed: true } }
  assert.equal((await app.service.submit(input)).remoteStatus, 'failed')
  assert.equal(app.creates, 1)
  app.context.capacity = async () => ({ limit: 1, occupied: 0 })
  const other = structuredClone(app.records.get(app.input.requestId)!)
  other.id = randomUUID()
  other.preview.id = other.id
  other.preview.draftId = randomUUID()
  app.records.set(other.id, other)
  assert.equal((await app.service.submit({ ...input, requestId: randomUUID() })).remoteStatus, 'failed')
  assert.equal(app.creates, 1)
})

test('上传期间平台容量变化仍拒绝重生成，不触发第二笔付费创建', async () => {
  const app = setup()
  await app.service.submit(app.input)
  let checks = 0
  app.context.capacity = async () => ({ limit: 1, occupied: ++checks === 1 ? 0 : 1 })
  const result = await app.service.submit({ ...app.input, requestId: randomUUID(),
    replacement: { taskIds: [app.input.requestId], confirmed: true } })
  assert.equal(result.remoteStatus, 'failed')
  assert.equal(app.creates, 1)
})

test('重生成确认不能覆盖错误草稿、漏掉的新任务或无远端ID的受理不明请求', async () => {
  const app = setup()
  await app.service.submit(app.input)
  const replacement = { taskIds: [app.input.requestId], confirmed: true as const }
  await assert.rejects(app.service.submit({ ...app.input, draftId: randomUUID(), requestId: randomUUID(), replacement }), /不匹配/)
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID(), replacement: { taskIds: [randomUUID()], confirmed: true } }), /不匹配/)
  const extra = structuredClone(app.records.get(app.input.requestId)!)
  extra.id = randomUUID()
  extra.preview.id = extra.id
  app.records.set(extra.id, extra)
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID(), replacement }), /未完成/)
  app.records.delete(extra.id)
  const old = app.records.get(app.input.requestId)!
  old.preview.taskId = ''
  old.phase = 'uncertain'
  app.records.set(old.id, old)
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID(), replacement }), /不匹配/)
  assert.equal(app.creates, 1)
})

test('重生成的创建受理不明只保留本次请求，不自动重提或换号', async () => {
  const app = setup()
  await app.service.submit(app.input)
  let calls = 0
  app.gateway.prepare = async () => ({ previewDefinition: '{}', upload: async () => 'openapi/image.png',
    create: async () => { calls += 1; throw new Error('simulated timeout') } })
  const input: SubmitGeneration = { ...app.input, requestId: randomUUID(), replacement: { taskIds: [app.input.requestId], confirmed: true } }
  assert.equal((await app.service.submit(input)).remoteStatus, 'unknown')
  await app.service.submit(input)
  assert.equal(calls, 1)
  assert.equal(app.records.get(input.requestId)?.phase, 'uncertain')
  await assert.rejects(app.service.submit({ ...input, requestId: randomUUID() }), /未完成/)
  assert.equal(calls, 1)
})

test('旧任务恢复仅检查原工作流和重建监听，保留任务与媒体，不再创建', async () => {
  const app = setup()
  await app.service.submit(app.input)
  await assert.rejects(app.service.refreshResults(app.input.requestId, true), /终态/)
  const record = app.records.get(app.input.requestId)!
  record.preview.remoteStatus = 'success'
  record.preview.connection = 'completed'
  record.preview.resultVideos = [{ source: 'https://rh-images.xiaoyaoyou.com/output/uuid.mp4', mime: 'video/mp4', receivedAt: new Date().toISOString() }]
  app.records.set(record.id, record)
  let inspections = 0
  app.gateway.inspectPreview = async (workflowId, credential) => {
    inspections += 1
    assert.equal(workflowId, record.preview.workflowId)
    assert.equal(credential, 'test-only-key')
    return '{"recovered":true}'
  }
  await app.service.refreshResults(record.id, false)
  assert.equal(inspections, 0)
  await app.service.refreshResults(record.id, true)
  const recovered = app.records.get(record.id)!
  assert.equal(inspections, 1)
  assert.equal(recovered.previewDefinition, '{"recovered":true}')
  assert.ok(recovered.previewDefinitionRecoveredAt)
  assert.equal(recovered.preview.taskId, record.preview.taskId)
  assert.deepEqual(recovered.preview.resultVideos, record.preview.resultVideos)
  assert.equal(app.creates, 1)
  assert.equal(app.restored, 3)
})

test('上传失败不调用付费创建，零容量和未绑定引用均拒绝', async () => {
  const app = setup()
  app.gateway.prepare = async () => ({ previewDefinition: '{}', upload: async () => { throw new Error('上传失败') }, create: async () => { throw new Error('不应调用') } })
  assert.equal((await app.service.submit(app.input)).remoteStatus, 'failed')
  assert.equal(app.creates, 0)
  const full = setup()
  full.context.capacity = async () => ({ limit: 0, occupied: 0 })
  assert.equal((await full.service.submit(full.input)).remoteStatus, 'failed')
  assert.equal(full.creates, 0)
  const unbound = setup()
  unbound.context.references = () => []
  await assert.rejects(unbound.service.submit(unbound.input), /未绑定/)
})

test('自动调度分别报告队列同步失败、远端满额和本地取消待确认占位', async () => {
  const app = setup()
  app.context.routes = () => [{ configId: app.input.workflowConfigId, accountId: app.input.expectedAccountId, workflowId: app.input.expectedWorkflowId }]
  const schedule = () => app.service.schedule({ requestId: randomUUID(), projectId: app.input.projectId,
    draftId: app.input.draftId, expectedRevision: 1, confirmed: true })
  app.context.capacity = async () => { throw new Error('queue unavailable') }
  await assert.rejects(schedule(), /队列容量查询失败/)
  app.context.capacity = async () => ({ limit: 1, occupied: 1 })
  await assert.rejects(schedule(), /远端容量已满.*当前任务 1.*并发上限 1/)
  app.context.capacity = async () => ({ limit: 1, occupied: 0 })
  await app.service.submit(app.input)
  const old = app.records.get(app.input.requestId)!
  old.preview.draftId = randomUUID()
  old.preview.cancelState = 'requested'
  old.preview.remoteStatus = 'unknown'
  app.records.set(old.id, old)
  await assert.rejects(schedule(), /本地有 1 笔未结束占位.*取消已受理/)
  assert.equal(app.creates, 1)
  // 同步到会员三并发后，单笔未知历史记录不应阻断其他两个空位。
  app.context.capacity = async () => ({ limit: 3, occupied: 0 })
  assert.ok((await schedule()).taskId)
  assert.equal(app.creates, 2)
})

test('已确认取消的其他草稿不占容量，未受理的新提交仍保留上传阶段保护', async () => {
  const app = setup()
  await app.service.submit(app.input)
  const old = app.records.get(app.input.requestId)!
  old.preview.draftId = randomUUID()
  old.preview.cancelState = 'requested'
  old.preview.remoteStatus = 'cancelled'
  app.records.set(old.id, old)
  app.context.routes = () => [{ configId: app.input.workflowConfigId, accountId: app.input.expectedAccountId, workflowId: app.input.expectedWorkflowId }]
  assert.ok((await app.service.schedule({ requestId: randomUUID(), projectId: app.input.projectId,
    draftId: app.input.draftId, expectedRevision: 1, confirmed: true })).taskId)
  assert.equal(app.creates, 2)
})

test('创建超时保留受理不明，重复标识及重启均不再次付费', async () => {
  const app = setup()
  let calls = 0
  app.gateway.prepare = async () => ({ previewDefinition: '{}', upload: async () => 'openapi/image.png',
    create: async () => { calls += 1; throw new Error('simulated timeout') } })
  const result = await app.service.submit(app.input)
  assert.equal(result.remoteStatus, 'unknown')
  assert.equal(app.records.get(app.input.requestId)?.phase, 'uncertain')
  await app.service.submit(app.input)
  new GenerationService(app.repository, app.context, app.gateway, app.previews, () => undefined).restore()
  assert.equal(calls, 1)
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), true)
})

test('平台明确拒绝与网络受理不明分开，不保留错误的并发占用', async () => {
  const app = setup()
  app.gateway.prepare = async () => ({ previewDefinition: '{}', upload: async () => 'openapi/image.png',
    create: async () => { throw new GenerationRejectedError('平台拒绝创建任务') } })
  assert.equal((await app.service.submit(app.input)).remoteStatus, 'failed')
  assert.equal(app.service.hasPending(app.input.projectId, app.input.draftId), false)
})

test('跨账号并发提交同一草稿也只能进入一次准备阶段', async () => {
  const app = setup()
  const first = app.service.submit(app.input)
  const another = randomUUID()
  app.context.workflow = () => ({ accountId: another, workflowId: '123456789012' })
  await assert.rejects(app.service.submit({ ...app.input, requestId: randomUUID(), expectedAccountId: another }), /未完成/)
  await first
  assert.equal(app.creates, 1)
})

test('SQLite v10 保存并重读独立任务快照，拒绝损坏的落库内容', async () => {
  const database = new WorkbenchDatabase(':memory:')
  try {
    const app = setup()
    await app.service.submit(app.input)
    const record = app.records.get(app.input.requestId)!
    // 此测试仅验证任务持久化；素材外键由单独的导入/删除用例覆盖。
    const withoutAssets = { ...record, references: [], replacedTaskIds: [randomUUID()], regenerationConfirmedAt: new Date().toISOString() }
    withoutAssets.preview.consumption = parseTaskConsumption([{ chargedPoint: '17', consumeMoney: null }])
    new SqliteGenerationRepository(database.connection).save(withoutAssets)
    const restored = new SqliteGenerationRepository(database.connection).list()[0]!
    assert.equal(restored.preview.taskId, '1234567890123456789')
    assert.equal(restored.draft.prompt, prompt)
    assert.deepEqual(restored.preview.consumption, withoutAssets.preview.consumption)
    assert.equal(JSON.stringify(restored).includes('test-only-key'), false)
    assert.deepEqual(restored.replacedTaskIds, withoutAssets.replacedTaskIds)
    assert.equal(restored.regenerationConfirmedAt, withoutAssets.regenerationConfirmedAt)
    assert.equal(database.connection.prepare('PRAGMA user_version').get()?.user_version, 10)
    database.connection.prepare('UPDATE generation_jobs SET snapshot = ?').run('{"id":"broken"}')
    assert.throws(() => new SqliteGenerationRepository(database.connection).list())
  } finally { database.close() }
})

test('采样媒体写受管文件，SQLite 保留索引与步数，重读后可播放下载', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-sampling-'))
  const database = new WorkbenchDatabase(':memory:')
  try {
    const app = setup()
    await app.service.submit(app.input)
    const files = new ManagedSamplingFiles(directory)
    const repository = new SqliteGenerationRepository(database.connection, files)
    repository.save({ ...app.records.get(app.input.requestId)!, references: [] })
    const service = new GenerationService(repository, app.context, app.gateway, app.previews, () => undefined)
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const media = { source: `data:image/jpeg;base64,${bytes.toString('base64')}`, mime: 'image/jpeg' as const, receivedAt: new Date().toISOString() }
    service.onPreview({ type: 'media', id: app.input.requestId, kind: 'sampling', media })
    const record = repository.list()[0]!
    assert.ok(record.preview.sampling?.source.startsWith('workbench-asset://sampling/'))
    assert.deepEqual(readFileSync(files.resolve(record.preview.sampling!.source)), bytes)
    assert.equal(files.forDownload(record.preview.sampling!).source, media.source)
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = record.preview
    service.onPreview({ type: 'state', state: { ...state, samplingStep: 4, samplingTotal: 4 } })
    const restored = repository.list()[0]!.preview
    assert.equal(restored.samplingStep, 4)
    assert.equal(restored.sampling?.source, record.preview.sampling?.source)
    assert.equal(String(database.connection.prepare('SELECT snapshot FROM generation_jobs').get()?.snapshot).includes('base64'), false)
    assert.throws(() => files.resolve('workbench-asset://sampling/../../private.mp4?v=1'))
    assert.throws(() => files.resolve(`workbench-asset://sampling/${app.input.requestId}.mp4?v=1&path=private`))
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }) }
})
