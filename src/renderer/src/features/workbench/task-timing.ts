import type { PreviewSnapshot } from '../../../../shared/contracts/preview'

export function taskTiming(task: PreviewSnapshot, now: number) {
  const terminal = Boolean(task.manualCancellationConfirmedAt) || task.remoteStatus === 'success' || task.remoteStatus === 'failed' || task.remoteStatus === 'cancelled'
  const paused = !terminal && task.cancelState === 'requested'
  // 暂停的是本地展示，不以取消接口回执冒充远端终态或释放并发。
  const end = terminal ? task.completedAt ?? task.manualCancellationConfirmedAt : paused ? task.cancelRequestedAt : new Date(now).toISOString()
  const seconds = task.executionSeconds ?? (task.runningObservedAt && end ? Math.max(0, (Date.parse(end) - Date.parse(task.runningObservedAt)) / 1000) : null)
  return { terminal, paused, ticking: !terminal && !paused, seconds,
    label: task.executionSeconds !== undefined ? '平台执行耗时' : task.manualCancellationConfirmedAt ? '截至人工确认' : paused ? '截至取消请求' : terminal ? '观测执行耗时' : '执行计时' }
}
