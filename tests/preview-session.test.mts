import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { RunningHubPreviewSession } from '../src/main/providers/runninghub/preview-session.ts'
import { inspectWorkflowPreview } from '../src/main/providers/runninghub/workflow-preview.ts'
import { previewSnapshotSchema, type PreviewSnapshot } from '../src/shared/contracts/preview.ts'
import type { TaskDiagnostic } from '../src/shared/contracts/task-diagnostics.ts'

function initial(): PreviewSnapshot {
  return { id: randomUUID(), taskId: '1234567890123456789', workflowId: '123456789012', workflowConfigId: randomUUID(),
    accountId: randomUUID(), projectId: randomUUID(), draftId: randomUUID(), connection: 'connecting', remoteStatus: 'queued',
    stage: '', capabilities: { status: 'checking', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
    step: 0, total: 0, samplingStep: 0, samplingTotal: 0, sampling: null, draft: null, final: null, notice: '', cancelState: 'none' }
}

const definition = JSON.stringify(inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify({
  low: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '%date:yyyyMMdd_hhmmss%_Minimax_H3', format: 'video/h264-mp4' } },
  high: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '%date:yyyyMMdd_hhmmss%_Minimax_H3_Upscale', format: 'video/h264-mp4' } }
}) } }))

test('历史 Upscale 错存为低清时按原前缀纠正成片并移除重复低清', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const url = 'https://rh-comfyui01.tos-cn-beijing.volces.com/output/20260920_140152_Minimax_H3_Upscale_00001.mp4'
  state.draft = { source: url, mime: 'video/mp4', receivedAt: new Date().toISOString() }
  const stale = JSON.parse(definition) as { videoOutputs: { nodeId: string; kind: string; prefix: string }[] }
  stale.videoOutputs = [{ nodeId: 'high', kind: 'draft', prefix: '20260920_140152_Minimax_H3_Upscale' }]
  globalThis.fetch = async (endpoint) => new Response(JSON.stringify(String(endpoint).endsWith('/query')
    ? { taskId: state.taskId, status: 'SUCCESS', results: [{ nodeId: 'high', url, outputType: 'mp4' }] } : { code: 0, data: [] }))
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: JSON.stringify(stale),
        emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed') resolve() } })
      session.start()
    })
    assert.equal(session!.snapshot().final?.source, url)
    assert.equal(session!.snapshot().draft, null)
    assert.equal(session!.snapshot().capabilities.final, true)
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('V2 按节点映射 TOS 视频，不依赖文件名，未知节点不冒充成片', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const base = 'https://rh-comfyui01.tos-cn-beijing.volces.com/output/'
  const logs: TaskDiagnostic[] = []
  const outputs = [
    { nodeId: 'low', url: `${base}opaque-low.mp4?signature=private`, outputType: 'mp4' },
    { nodeId: 'high', url: `${base}opaque-high.mp4`, outputType: 'mp4' },
    { nodeId: 'unknown', url: `${base}20261020_113429_Minimax_H3_Upscale_00001.mp4`, outputType: 'mp4' }
  ]
  globalThis.fetch = async (endpoint) => new Response(JSON.stringify(String(endpoint).endsWith('/query')
    ? { taskId: state.taskId, status: 'SUCCESS', results: outputs } : { code: 0, data: [] }))
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: () => undefined, diagnose: (entry) => { logs.push(entry); if (entry.event === 'summary') resolve() } })
      session.start()
    })
    const result = session!.snapshot()
    assert.equal(result.draft?.source, outputs[0]!.url)
    assert.equal(result.final?.source, outputs[1]!.url)
    assert.equal(result.resultVideos?.length, 3)
    assert.ok(logs.some((entry) => entry.nodeId === 'unknown' && entry.role === 'unclassified'))
    assert.equal(JSON.stringify(logs).includes('signature'), false)
    assert.equal(JSON.stringify(logs).includes('test-only-key'), false)
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('被拒域名单独记日志并明确提示，不再宣称平台未返回', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const logs: TaskDiagnostic[] = []
  globalThis.fetch = async (endpoint) => new Response(JSON.stringify(String(endpoint).endsWith('/query')
    ? { taskId: state.taskId, status: 'SUCCESS', results: [{ nodeId: 'high', url: 'https://unapproved.invalid/private.mp4?token=secret', outputType: 'mp4' }] }
    : { code: 0, data: [] }))
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: () => undefined, diagnose: (entry) => { logs.push(entry); if (entry.event === 'summary') resolve() } })
      session.start()
    })
    assert.match(session!.snapshot().notice, /安全规则拒绝/)
    assert.equal(session!.snapshot().final, null)
    assert.ok(logs.some((entry) => entry.reason === 'domain-rejected' && entry.host === 'unapproved.invalid'))
    assert.equal(JSON.stringify(logs).includes('secret'), false)
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('V2 确认终态后按原节点快照接收 UUID 地址，并记录平台耗时', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const calls: string[] = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify(String(url).endsWith('/query')
      ? { taskId: state.taskId, status: 'SUCCESS', results: [] }
      : { code: 0, data: [
        { nodeId: 'low', fileUrl: 'https://rh-images.xiaoyaoyou.com/uuid-low.mp4', fileType: 'mp4', taskCostTime: '83.5', consumeCoins: '17' },
        { nodeId: 'high', fileUrl: 'https://rh-images.xiaoyaoyou.com/uuid-high.mp4', fileType: 'mp4', taskCostTime: '83.5', consumeCoins: '17' },
        { nodeId: 'unknown', fileUrl: 'https://rh-images.xiaoyaoyou.com/not-final.mp4', fileType: 'mp4', taskCostTime: '83.5', consumeCoins: '17' }
      ] }))
  }
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed' && event.state.executionSeconds !== undefined) resolve() } })
      session.start()
    })
    const result = session!.snapshot()
    assert.equal(result.remoteStatus, 'success')
    assert.equal(result.executionSeconds, 83.5)
    assert.equal(result.consumption?.coins, '17')
    assert.ok(result.completedAt)
    assert.equal(result.runningObservedAt, undefined)
    assert.equal(result.draft?.source, 'https://rh-images.xiaoyaoyou.com/uuid-low.mp4')
    assert.equal(result.final?.source, 'https://rh-images.xiaoyaoyou.com/uuid-high.mp4')
    assert.equal(result.notice, '')
    assert.equal(calls.length, 2)
    assert.ok(calls.every((url) => !url.endsWith('/create')))
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('兼容结果接口失败不覆盖 V2 成功与日期命名媒体', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const base = 'https://rh-images.xiaoyaoyou.com/20261020_113429_Minimax_H3'
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/query')) throw new Error('模拟旧接口不可用')
    return new Response(JSON.stringify({ taskId: state.taskId, status: 'SUCCESS', results: [
      { url: `${base}_00001.mp4`, outputType: 'mp4' }, { url: `${base}_Upscale_00001.mp4`, outputType: 'mp4' }
    ] }))
  }
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed') resolve() } })
      session.start()
    })
    const result = session!.snapshot()
    assert.equal(result.remoteStatus, 'success')
    assert.equal(result.executionSeconds, undefined)
    assert.equal(result.final?.source, `${base}_Upscale_00001.mp4`)
    assert.equal(result.draft?.source, `${base}_00001.mp4`)
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('旧快照兼容缺失时间字段，新时间字段持久化校验不接受负值', () => {
  const old = initial()
  assert.equal(previewSnapshotSchema.safeParse(old).success, true)
  assert.equal(previewSnapshotSchema.safeParse({ ...old, executionSeconds: -1 }).success, false)
  assert.equal(previewSnapshotSchema.safeParse({ ...old, executionSeconds: 83.5, requestedDuration: 8 }).success, true)
  assert.equal(previewSnapshotSchema.safeParse({ ...old, remoteStatus: 'cancelled', cancelRequestedAt: '2026-10-21T00:00:00.000Z' }).success, true)
  assert.equal(previewSnapshotSchema.safeParse({ ...old, cancelRequestedAt: 'invalid' }).success, false)
})

test('取消接口成功只记录回执时间，不伪造终态；重复请求不会再次发送', async () => {
  const originalFetch = globalThis.fetch
  const state = { ...initial(), remoteStatus: 'running' as const }
  let calls = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/query')) return new Response(JSON.stringify({ taskId: state.taskId, status: 'RUNNING' }))
    assert.ok(String(url).endsWith('/cancel'))
    calls += 1
    return new Response(JSON.stringify({ code: 0 }))
  }
  const session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition, emit: () => undefined })
  try {
    await session.cancel()
    const result = session.snapshot()
    assert.equal(result.remoteStatus, 'running')
    assert.equal(result.cancelState, 'requested')
    assert.ok(result.cancelRequestedAt)
    assert.equal(result.completedAt, undefined)
    await session.cancel()
    assert.equal(calls, 1)
  } finally { session.stop(); globalThis.fetch = originalFetch }
})

for (const status of ['CANCELLED', 'CANCELED', ' cancelled ', 'canceled']) {
  test(`V2 ${status} 确认为取消终态，保留采样且不再查询输出`, { timeout: 2000 }, async () => {
    const originalFetch = globalThis.fetch
    const state = { ...initial(), cancelState: 'requested' as const, remoteStatus: 'unknown' as const }
    state.sampling = { source: 'https://rh-images.xiaoyaoyou.com/preview.png', mime: 'image/png', receivedAt: '2026-10-21T00:00:00.000Z' }
    let calls = 0
    globalThis.fetch = async (url) => {
      assert.ok(String(url).endsWith('/query'))
      calls += 1
      return new Response(JSON.stringify({ taskId: state.taskId, status, results: null }))
    }
    let session: RunningHubPreviewSession | undefined
    try {
      await new Promise<void>((resolve) => {
        session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
          emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed') resolve() } })
        session.start()
      })
      const result = session!.snapshot()
      assert.equal(result.remoteStatus, 'cancelled')
      assert.equal(result.stage, '远端任务已取消')
      assert.ok(result.completedAt)
      assert.equal(result.notice, '')
      assert.deepEqual(result.sampling, state.sampling)
      assert.equal(calls, 1)
      await assert.rejects(session!.cancel(), /不能再请求取消/)
    } finally { session?.stop(); globalThis.fetch = originalFetch }
  })
}

test('未知远端状态即使已有取消回执也不当成已取消', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = { ...initial(), cancelState: 'requested' as const }
  globalThis.fetch = async () => new Response(JSON.stringify({ taskId: state.taskId, status: 'UNRECOGNIZED', results: null }))
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: (event) => { if (event.type === 'state' && event.state.remoteStatus === 'unknown') resolve() } })
      session.start()
    })
    assert.equal(session!.snapshot().remoteStatus, 'unknown')
    assert.equal(session!.snapshot().completedAt, undefined)
  } finally { session?.stop(); globalThis.fetch = originalFetch }
})

test('取消受理后立即查询终态，不等待预览接口，确认取消后停止占位状态', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = { ...initial(), remoteStatus: 'running' as const }
  const calls: string[] = []
  let finish: (() => void) | undefined
  const completed = new Promise<void>((resolve) => { finish = resolve })
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname
    calls.push(path)
    if (path.endsWith('/cancel')) return new Response(JSON.stringify({ code: 0 }))
    assert.ok(path.endsWith('/query'))
    return new Response(JSON.stringify({ taskId: state.taskId, status: 'CANCELLED' }))
  }
  const session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
    emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed') finish?.() } })
  try {
    await session.cancel()
    await completed
    assert.equal(session.snapshot().remoteStatus, 'cancelled')
    assert.equal(session.snapshot().cancelState, 'requested')
    assert.ok(session.snapshot().completedAt)
    assert.deepEqual(calls, ['/task/openapi/cancel', '/openapi/v2/query'])
  } finally { session.stop(); globalThis.fetch = originalFetch }
})

test('取消待确认时不访问输出接口，未知状态不伪造终态并定时核对', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = { ...initial(), cancelState: 'requested' as const }
  let finish: (() => void) | undefined
  const checked = new Promise<void>((resolve) => { finish = resolve })
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith('/query'))
    return new Response(JSON.stringify({ taskId: state.taskId, status: 'UNRECOGNIZED' }))
  }
  const session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
    emit: (event) => { if (event.type === 'state' && event.state.stage === '取消已受理，正在核对远端终态') finish?.() } })
  try {
    session.start()
    await checked
    assert.equal(session.snapshot().remoteStatus, 'unknown')
    assert.equal(session.snapshot().completedAt, undefined)
    assert.match(session.snapshot().notice, /尚未确认远端终止/)
  } finally { session.stop(); globalThis.fetch = originalFetch }
})

test('V2 UUID 视频在旧接口仍等待时即可保存，不猜测输出角色', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch
  const state = initial()
  const url = 'https://rh-images.xiaoyaoyou.com/output/uuid.mp4'
  let release: (() => void) | undefined
  const legacyGate = new Promise<void>((resolve) => { release = resolve })
  globalThis.fetch = async (endpoint) => {
    if (String(endpoint).endsWith('/query')) return new Response(JSON.stringify({ taskId: state.taskId, status: 'SUCCESS', results: [{ url, outputType: 'mp4' }] }))
    await legacyGate
    throw new Error('旧接口不可用')
  }
  let session: RunningHubPreviewSession | undefined
  try {
    await new Promise<void>((resolve) => {
      session = new RunningHubPreviewSession({ initial: state, credential: 'test-only-key', workflowDefinition: definition,
        emit: (event) => { if (event.type === 'state' && event.state.connection === 'completed') resolve() } })
      session.start()
    })
    const result = session!.snapshot()
    assert.equal(result.resultVideos?.[0]?.source, url)
    assert.equal(result.remoteStatus, 'success')
    assert.equal(result.final, null)
    assert.equal(result.draft, null)
    assert.equal(previewSnapshotSchema.safeParse(result).success, true)
  } finally { session?.stop(); release?.(); globalThis.fetch = originalFetch }
})
