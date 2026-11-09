import type { PreviewSnapshot } from '../../../../shared/contracts/preview'

export function taskTiming(task: PreviewSnapshot, now: number) {
  const terminal = Boolean(task.manualCancellationConfirmedAt) || task.remoteStatus === 'success' || task.remoteStatus === 'failed' || task.remoteStatus === 'cancelled'
  const paused = !terminal && task.cancelState === 'requested'
  // 暂停的是本地展示，不以取消接口回执冒充远端终态或释放并发。
  const end = terminal ? task.completedAt ?? task.manualCancellationConfirmedAt : paused ? task.cancelRequestedAt : new Date(now).toISOString()
  // 平台部分输出返回 0 作为占位，不能覆盖已观测到的运行时间；旧快照也在展示时兼容。
  const platformSeconds = task.executionSeconds !== undefined && Number.isFinite(task.executionSeconds) && task.executionSeconds > 0 ? task.executionSeconds : null
  const observedStart = task.runningObservedAt ?? (terminal ? task.submittedAt : undefined)
  const observedSeconds = observedStart && end ? (Date.parse(end) - Date.parse(observedStart)) / 1000 : null
  const elapsed = observedSeconds !== null && Number.isFinite(observedSeconds) && observedSeconds >= 0 && (!terminal || observedSeconds > 0) ? observedSeconds : null
  const seconds = platformSeconds ?? elapsed
  const source = platformSeconds !== null ? 'platform' : elapsed === null ? null : task.runningObservedAt ? 'observed' : 'total'
  return { terminal, paused, ticking: !terminal && !paused, seconds, source,
    label: source === 'platform' ? '平台执行耗时' : source === 'total' ? '任务总耗时（含排队）' : task.manualCancellationConfirmedAt ? '截至人工确认' : paused ? '截至取消请求' : terminal ? '观测执行耗时' : '执行计时' }
}
