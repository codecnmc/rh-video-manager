import test from 'node:test'
import assert from 'node:assert/strict'
import type { PreviewSnapshot, RemoteStatus } from '../src/shared/contracts/preview.ts'
import { summarizeQueue } from '../src/renderer/src/features/workbench/queue-state.ts'
import { taskTiming } from '../src/renderer/src/features/workbench/task-timing.ts'
import { useWorkbenchUi } from '../src/renderer/src/features/workbench/workbench-store.ts'

function task(remoteStatus: RemoteStatus): PreviewSnapshot {
  return { id: remoteStatus, taskId: '12345678', workflowId: '12345678', workflowConfigId: 'workflow', accountId: 'account',
    projectId: 'project', draftId: 'draft', capabilities: { status: 'checking', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
    connection: 'connected', remoteStatus, stage: '', step: 0, total: 0, samplingStep: 0, samplingTotal: 0,
    sampling: null, draft: null, final: null, notice: '', cancelState: 'none' }
}

test('本地队列统计全部终态与未知状态，不把未知任务当作运行', () => {
  assert.deepEqual(summarizeQueue([]), { total: 0, running: 0, queued: 0, success: 0, failed: 0, cancelled: 0, unknown: 0 })
  assert.deepEqual(summarizeQueue(['running', 'running', 'queued', 'success', 'failed', 'cancelled', 'unknown'].map((status) => task(status as RemoteStatus))),
    { total: 7, running: 2, queued: 1, success: 1, failed: 1, cancelled: 1, unknown: 1 })
})

test('取消被接受后冻结至请求时刻，但不冒充已结束；旧记录不猜取消时间', () => {
  const state = { ...task('unknown'), cancelState: 'requested' as const,
    runningObservedAt: '2026-10-21T00:00:00.000Z', cancelRequestedAt: '2026-10-21T00:05:00.000Z' }
  const first = taskTiming(state, Date.parse('2026-10-21T00:10:00.000Z'))
  assert.equal(first.seconds, 300)
  assert.equal(first.ticking, false)
  assert.equal(first.terminal, false)
  assert.equal(first.label, '截至取消请求')
  assert.deepEqual(taskTiming(state, Date.parse('2026-10-22T00:00:00.000Z')), first)
  const legacy = taskTiming({ ...state, cancelRequestedAt: undefined }, Date.now())
  assert.equal(legacy.seconds, null)
  assert.equal(legacy.ticking, false)
})

test('已取消使用终态时间；正常运行及取消拒绝仍计时，平台耗时优先', () => {
  const start = Date.parse('2026-10-21T00:00:00.000Z')
  const state = { ...task('running'), runningObservedAt: new Date(start).toISOString() }
  assert.equal(taskTiming(state, start + 10000).seconds, 10)
  assert.equal(taskTiming({ ...state, cancelState: 'rejected' }, start + 20000).ticking, true)
  const cancelled = { ...state, remoteStatus: 'cancelled' as const, completedAt: new Date(start + 30000).toISOString() }
  assert.equal(taskTiming(cancelled, start + 60000).seconds, 30)
  assert.equal(taskTiming(cancelled, start + 60000).ticking, false)
  assert.equal(taskTiming({ ...cancelled, executionSeconds: 25 }, start + 60000).seconds, 25)
})

test('浮窗默认关闭，打开不修改草稿选择，切换项目或进入完整队列时关闭', () => {
  const initial = useWorkbenchUi.getState()
  assert.equal(initial.queueOpen, false)
  try {
    initial.selectProject('project-a')
    initial.selectDraft('draft-a')
    initial.setQueueOpen(true)
    assert.equal(useWorkbenchUi.getState().queueOpen, true)
    assert.equal(useWorkbenchUi.getState().draftId, 'draft-a')
    initial.setView('tasks')
    assert.equal(useWorkbenchUi.getState().view, 'tasks')
    assert.equal(useWorkbenchUi.getState().queueOpen, false)
    initial.setQueueOpen(true)
    initial.selectProject('project-b')
    assert.equal(useWorkbenchUi.getState().queueOpen, false)
    assert.equal(useWorkbenchUi.getState().draftId, null)
    initial.selectDraft('draft-b')
    initial.setView('video')
    assert.equal(useWorkbenchUi.getState().draftId, 'draft-b')
  } finally { useWorkbenchUi.setState(initial, true) }
})
