import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowRunMonitor } from '../src/main/modules/workflows/application/workflow-run-monitor.ts'
import type { WorkflowRun } from '../src/shared/contracts/workflow-runs.ts'

const run: WorkflowRun = { id: '11111111-1111-4111-8111-111111111111', workflowId: '22222222-2222-4222-8222-222222222222',
  workflowName: '声音设计', accountId: '33333333-3333-4333-8333-333333333333', kind: 'audio', taskId: '2120403002245480449',
  status: 'running', createdAt: 'now', updatedAt: 'now', message: '', assets: [] }

test('启动后自动查询已有任务，忽略终态及无远端编号的受理不明任务', async () => {
  const calls: string[] = []
  const monitor = new WorkflowRunMonitor({ list: () => [run, { ...run, id: 'done', status: 'success', points: '1', executionSeconds: 12, metricsCheckedAt: 'checked' }, { ...run, id: 'unknown', taskId: '', status: 'unknown' }],
    refresh: async (id) => { calls.push(id); return { ...run, status: 'success' } } })
  try { monitor.start(); await Promise.resolve(); assert.deepEqual(calls, [run.id]) } finally { monitor.stop() }
})

test('快照暂停期间不查询，停止后可安全重复停止', () => {
  let queries = 0
  const monitor = new WorkflowRunMonitor({ canMonitor: () => false, list: () => [run], refresh: async () => { queries++; return run } })
  monitor.start(); monitor.stop(); monitor.stop()
  assert.equal(queries, 0)
})
