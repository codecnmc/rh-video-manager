import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowRunService } from '../src/main/modules/workflows/application/workflow-run-service.ts'
import type { WorkflowRunContext, WorkflowRunRepository } from '../src/main/modules/workflows/ports/workflow-runs.ts'
import type { StartWorkflowRun, WorkflowRun } from '../src/shared/contracts/workflow-runs.ts'

const workflowId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'
const form = { fields: [{ key: 'input-test', title: '文本', type: 'text' as const, defaultValue: '' }], inspectedAt: 'now' }
const input: StartWorkflowRun = { requestId: '33333333-3333-4333-8333-333333333333', workflowId, expectedCheckedAt: 'now', instance: 'default', confirmed: true, values: { 'input-test': '测试' } }
function setup(context: Partial<WorkflowRunContext> = {}) {
  const rows = new Map<string, WorkflowRun>()
  const repository: WorkflowRunRepository = { list: () => structuredClone([...rows.values()]), save: (run) => { rows.set(run.id, structuredClone(run)) } }
  let creates = 0
  const service = new WorkflowRunService(repository, {
    workflow: () => ({ id: workflowId, accountId, name: '声音', workflowId: '2120362280813682689', enabled: true, isDefault: false, kind: 'audio', form, checkedAt: 'now', capabilities: null, error: '' }),
    assertCapacity: async () => undefined,
    prepare: async () => ({ form, submit: async () => { creates++; return '2120362280813682690' } }),
    query: async () => ({ status: 'running', outputs: [] }),
    archive: async () => { throw new Error('不应下载') }, ...context
  })
  return { service, creates: () => creates }
}
test('同一请求只创建一次任务', async () => {
  const { service, creates } = setup()
  assert.equal((await service.start(input)).status, 'running')
  await service.start(input)
  assert.equal(creates(), 1)
})
test('失败记录隐藏后仍保留幂等保护，运行中记录不允许移除', async () => {
  const { service, creates } = setup({ assertCapacity: async () => { throw new Error('并发已满') } })
  const failed = await service.start(input)
  service.removeFailed(failed.id, failed.updatedAt)
  assert.equal(service.list().length, 0)
  assert.equal((await service.start(input)).status, 'failed')
  assert.equal(creates(), 0)
  const running = setup()
  const accepted = await running.service.start(input)
  assert.throws(() => running.service.removeFailed(accepted.id, accepted.updatedAt), /仅可移除/)
})
test('已有成功记录补查积分时长不重新归档或生成', async () => {
  let archives = 0
  const { service, creates } = setup({ query: async () => ({ status: 'success', points: '1.28', executionSeconds: 12, outputs: [{ url: 'https://example.invalid/a.wav', extension: 'wav', kind: 'audio' }] }),
    archive: async () => { archives++; return { id: '55555555-5555-4555-8555-555555555555', name: 'a.wav', kind: 'audio' } } })
  await service.start(input)
  const result = await service.refresh(input.requestId)
  assert.equal(result.points, '1.28')
  assert.equal(result.executionSeconds, 12)
  await service.refresh(input.requestId)
  assert.equal(archives, 1)
  assert.equal(creates(), 1)
})
test('受理不明不自动重提，保留单笔并发占位', async () => {
  let creates = 0
  const { service } = setup({ prepare: async () => ({ form, submit: async () => { creates++; throw new Error('传输中断') } }) })
  assert.equal((await service.start(input)).status, 'unknown')
  await service.start(input)
  assert.equal(service.reservationCount(accountId), 1)
  assert.equal(creates, 1)
})
test('同账号视频与声音共享容量，有剩余时可提交，满额才阻止', async () => {
  let service: WorkflowRunService
  const result = setup({ assertCapacity: async (owner, currentId) => {
    const videoReservations = 1
    if (videoReservations + service.reservationCount(owner, currentId) >= 3) throw new Error('并发已满')
  } })
  service = result.service
  assert.equal((await service.start(input)).status, 'running')
  assert.equal((await service.start({ ...input, requestId: '44444444-4444-4444-8444-444444444444' })).status, 'running')
  const blocked = await service.start({ ...input, requestId: '55555555-5555-4555-8555-555555555555' })
  assert.equal(blocked.status, 'failed')
  assert.match(blocked.message, /并发已满/)
  assert.equal(result.creates(), 2)
})
test('上传后容量变满时不创建任务', async () => {
  let checks = 0
  const { service, creates } = setup({ assertCapacity: async () => { if (++checks === 2) throw new Error('并发已满') } })
  assert.equal((await service.start(input)).status, 'failed')
  assert.equal(checks, 2)
  assert.equal(creates(), 0)
})
test('下载失败仅重试尚未归档产物，不重新生成', async () => {
  const calls: number[] = []
  let fail = true
  const { service, creates } = setup({
    query: async () => ({ status: 'success', outputs: [0, 1].map((index) => ({ url: `https://example.invalid/${index}.wav`, extension: 'wav', kind: 'audio' as const })) }),
    archive: async (_run, _output, index) => { calls.push(index); if (index === 1 && fail) throw new Error('下载失败'); return { id: index === 0 ? '55555555-5555-4555-8555-555555555555' : '66666666-6666-4666-8666-666666666666', name: `${index}.wav`, kind: 'audio' } }
  })
  await service.start(input)
  assert.equal((await service.refresh(input.requestId)).status, 'download-error')
  fail = false
  assert.equal((await service.refresh(input.requestId)).status, 'success')
  assert.deepEqual(calls, [0, 1, 1])
  assert.equal(creates(), 1)
})
