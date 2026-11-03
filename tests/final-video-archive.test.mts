import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedFinalVideoFiles, finalVideoAssetId } from '../src/main/infrastructure/files/final-video-files.ts'
import { GenerationService } from '../src/main/modules/jobs/application/generation-service.ts'
import { PreviewService } from '../src/main/modules/jobs/application/preview-service.ts'
import type { GenerationRecord, GenerationRepository, FinalVideoArchive } from '../src/main/modules/jobs/ports/generation.ts'
import type { PreviewEvent } from '../src/shared/contracts/preview.ts'

const source = 'https://media.example.com/final.mp4?signature=one'
const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])

test('成片稳定标识忽略签名参数但区分任务与输出路径', () => {
  const id = randomUUID()
  assert.equal(finalVideoAssetId(id, source), finalVideoAssetId(id, source.replace('one', 'two')))
  assert.notEqual(finalVideoAssetId(id, source), finalVideoAssetId(randomUUID(), source))
  assert.notEqual(finalVideoAssetId(id, source), finalVideoAssetId(id, source.replace('final.mp4', 'other.mp4')))
})

test('完整下载后独占落位，签名刷新重试复用本地成片', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-final-archive-'))
  let requests = 0
  context.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response(mp4) })
  try {
    const files = new ManagedFinalVideoFiles(directory, (url) => url.startsWith('https://media.example.com/'))
    const jobId = randomUUID()
    const first = await files.save(jobId, source, new AbortController().signal)
    const second = await files.save(jobId, source.replace('one', 'two'), new AbortController().signal)
    assert.equal(first.id, second.id)
    assert.equal(requests, 1)
    assert.deepEqual(new Uint8Array(await readFile(join(directory, first.storedName))), mp4)
    assert.equal((await readdir(directory)).some((name) => name.endsWith('.part')), false)
    await assert.rejects(files.save(jobId, 'http://127.0.0.1/secret', new AbortController().signal), /允许范围/)
    assert.equal(requests, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('拒绝伪装 MP4 的错误响应并清理临时文件', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-final-invalid-'))
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>expired</html>'))
  try {
    const files = new ManagedFinalVideoFiles(directory, () => true)
    await assert.rejects(files.save(randomUUID(), source, new AbortController().signal), /MP4/)
    assert.deepEqual(await readdir(directory), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

function setup(archive: FinalVideoArchive) {
  const id = randomUUID()
  const job: GenerationRecord = { id, phase: 'accepted', createdAt: new Date().toISOString(), references: [], previewDefinition: '{}',
    draft: { id: randomUUID(), title: '最终成片测试', description: '', prompt: '已确认提示词', promptDocument: '', duration: 8,
      aspectRatio: '9:16', resolution: '720P', instance: 'default', instanceMode: 'auto' },
    preview: { id, taskId: '12345678901234567', workflowId: '12345678', workflowConfigId: randomUUID(), accountId: randomUUID(), projectId: randomUUID(), draftId: randomUUID(),
      capabilities: { status: 'ready', sampling: true, draft: true, final: true, unclassifiedOutputs: 0 },
      connection: 'completed', remoteStatus: 'success', stage: '生成完成', executionSeconds: 10, step: 1, total: 1, samplingStep: 1, samplingTotal: 1,
      sampling: null, draft: null, final: { source, mime: 'video/mp4', receivedAt: new Date().toISOString() }, notice: '', cancelState: 'none' } }
  let saved = structuredClone(job)
  const repository: GenerationRepository = { list: () => [structuredClone(saved)], save: (value) => { saved = structuredClone(value) } }
  const events: PreviewEvent[] = []
  const unavailable = () => { throw new Error('禁止调用付费或任务查询接口') }
  const previews = new PreviewService(unavailable, (event) => events.push(event))
  const service = new GenerationService(repository, { draft: unavailable, references: unavailable, workflow: unavailable, credential: unavailable, capacity: unavailable },
    { inspectPreview: unavailable, prepare: unavailable }, previews, (event) => events.push(event), archive)
  return { job, service, repository, events }
}

test('恢复已成功任务立即归档，重复远端事件不重复保存、不覆盖本地就绪状态', async () => {
  let calls = 0
  const assetId = randomUUID()
  const app = setup({ save: async () => { calls += 1; return assetId } })
  try {
    app.service.restore()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(app.service.list()[0]!.finalArchive?.status, 'ready')
    assert.equal(app.service.list()[0]!.finalArchive?.assetId, assetId)
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = app.job.preview
    app.service.onPreview({ type: 'state', state })
    app.service.onPreview({ type: 'media', id: app.job.id, kind: 'final', media: app.job.preview.final! })
    assert.equal(calls, 1)
    assert.equal(app.service.list()[0]!.finalArchive?.status, 'ready')
    assert.equal(app.service.list()[0]!.remoteStatus, 'success')
  } finally { app.service.stop() }
})

test('归档失败不改变生成成功状态，可手动重试且不重新生成', async () => {
  let calls = 0
  const app = setup({ save: async () => { if (++calls === 1) throw new Error('offline'); return randomUUID() } })
  try {
    app.service.restore()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(app.service.list()[0]!.finalArchive?.status, 'failed')
    assert.equal(app.service.list()[0]!.remoteStatus, 'success')
    app.service.retryFinalArchive(app.job.id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    assert.equal(app.service.list()[0]!.finalArchive?.status, 'ready')
  } finally { app.service.stop() }
})
