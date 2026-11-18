import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PreviewSnapshot, PreviewEvent } from '../src/shared/contracts/preview.ts'
import { ComfyPreviewSession } from '../src/main/providers/comfyui/preview-session.ts'
import { ComfyClient } from '../src/main/providers/comfyui/client.ts'

class TestSocket extends EventTarget {
  binaryType = ''
  close() {}
  sendEvent(type: string, data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, data }) })) }
}

test('接收无 prompt_id 的 KJ、原生图片和新版进度；隔离其他任务与节点', async (context) => {
  const socket = new TestSocket()
  // 替身仅模拟会话用到的 WebSocket 事件，不建立网络连接。
  context.mock.method(ComfyClient.prototype, 'socket', () => socket as unknown as WebSocket)
  context.mock.method(ComfyClient.prototype, 'request', async () => ({}))
  const taskId = randomUUID()
  const events: PreviewEvent[] = []
  const initial: PreviewSnapshot = { id: randomUUID(), taskId, workflowId: randomUUID(), workflowConfigId: randomUUID(), accountId: randomUUID(),
    provider: 'comfyui', projectId: randomUUID(), draftId: randomUUID(),
    capabilities: { status: 'checking', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
    connection: 'connecting', remoteStatus: 'queued', stage: '', step: 0, total: 0, samplingStep: 0, samplingTotal: 0,
    sampling: null, draft: null, final: null, notice: '', cancelState: 'none' }
  const session = new ComfyPreviewSession({ initial, credential: '', emit: (event) => events.push(event),
    workflowDefinition: JSON.stringify({ address: 'http://127.0.0.1:8188', clientId: randomUUID(), nodes: { sample: 'SelfLiftH3Sampler' },
      preview: { samplingNodes: ['preview'], videoOutputs: [], capabilities: { status: 'ready', sampling: true, draft: false, final: true, unclassifiedOutputs: 0 } } }) })
  context.after(() => session.stop())
  session.start()
  assert.equal(session.snapshot().capabilities.status, 'ready')
  socket.dispatchEvent(new Event('open'))
  socket.sendEvent('executing', { prompt_id: taskId, node: 'sample' })
  assert.match(session.snapshot().stage, /SelfLiftH3Sampler/)
  socket.sendEvent('kj_preview_override', { node_id: 'preview', step: 2, total: 8, image: Buffer.from([255, 216, 255, 217]).toString('base64'), mime: 'image/jpeg' })
  assert.equal(session.snapshot().samplingStep, 2)
  assert.ok(events.some((event) => event.type === 'media' && event.kind === 'sampling'))
  const count = events.length
  socket.sendEvent('kj_preview_override', { node_id: 'other-node', step: 8, total: 8 })
  socket.sendEvent('progress', { prompt_id: randomUUID(), value: 8, max: 8 })
  assert.equal(events.length, count)
  socket.sendEvent('progress_state', { prompt_id: taskId, nodes: { sample: { state: 'running', value: 3, max: 8 } } })
  assert.equal(session.snapshot().step, 3)
  const binary = new ArrayBuffer(12)
  const view = new DataView(binary)
  view.setUint32(0, 1); view.setUint32(4, 1)
  new Uint8Array(binary, 8).set([255, 216, 255, 217])
  socket.dispatchEvent(new MessageEvent('message', { data: binary }))
  assert.equal(events.filter((event) => event.type === 'media').length, 2)
  socket.sendEvent('executing', { prompt_id: randomUUID(), node: 'other' })
  socket.dispatchEvent(new MessageEvent('message', { data: binary }))
  assert.equal(events.filter((event) => event.type === 'media').length, 2)
  socket.dispatchEvent(new Event('close'))
  assert.equal(session.snapshot().connection, 'reconnecting')
  assert.match(session.snapshot().notice, /实时进度连接已断开/)
  session.stop()
  await new Promise<void>((resolve) => setImmediate(resolve))
})

test('运行中终止只请求原任务，接口成功不冒充已取消，重复点击不重发', async (context) => {
  const taskId = randomUUID()
  const requests: string[] = []
  context.mock.method(ComfyClient.prototype, 'request', async () => ({ queue_running: [[0, taskId]], queue_pending: [] }))
  context.mock.method(ComfyClient.prototype, 'interrupt', async (id: string) => { requests.push(id) })
  const initial: PreviewSnapshot = { id: randomUUID(), taskId, workflowId: randomUUID(), workflowConfigId: randomUUID(), accountId: randomUUID(),
    provider: 'comfyui', projectId: randomUUID(), draftId: randomUUID(),
    capabilities: { status: 'ready', sampling: true, draft: false, final: true, unclassifiedOutputs: 0 },
    connection: 'connected', remoteStatus: 'running', stage: '', step: 2, total: 12, samplingStep: 2, samplingTotal: 12,
    sampling: null, draft: null, final: null, notice: '', cancelState: 'none' }
  const session = new ComfyPreviewSession({ initial, credential: '', emit: () => {}, workflowDefinition: JSON.stringify({ address: 'http://localhost:8188' }) })
  context.after(() => session.stop())
  await session.cancel()
  assert.deepEqual(requests, [taskId])
  assert.equal(session.snapshot().cancelState, 'requested')
  assert.equal(session.snapshot().remoteStatus, 'running')
  await session.cancel()
  assert.equal(requests.length, 1)
})

test('指定任务中断支持空响应，始终传 prompt_id，不发全局中断', async (context) => {
  const client = new ComfyClient('http://localhost:8188')
  const taskId = randomUUID()
  context.mock.method(client, 'request', async () => ({ system: { comfyui_version: '0.42.5' } }))
  const calls: { url: string; body: string }[] = []
  context.mock.method(globalThis, 'fetch', async (url: string, input: RequestInit) => {
    calls.push({ url, body: String(input.body) })
    return new Response(null, { status: 200 })
  })
  await client.interrupt(taskId)
  assert.deepEqual(calls, [{ url: 'http://localhost:8188/interrupt', body: JSON.stringify({ prompt_id: taskId }) }])
})
