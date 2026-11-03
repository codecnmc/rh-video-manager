import type { PreviewSnapshot } from '../../../../shared/contracts/preview'

export function queueStatus(task: PreviewSnapshot) {
  if (['success', 'failed', 'cancelled'].includes(task.remoteStatus)) return task.remoteStatus
  if (task.manualCancellationConfirmedAt) return 'cancelled'
  return ['requested', 'uncertain'].includes(task.cancelState) ? 'unknown' : task.remoteStatus
}

export function canResolveTask(task: PreviewSnapshot) {
  return Boolean(task.taskId) && !['success', 'failed', 'cancelled'].includes(queueStatus(task)) &&
    (task.remoteStatus === 'unknown' || task.cancelState === 'requested' || task.connection === 'disconnected')
}

export function summarizeQueue(tasks: PreviewSnapshot[]) {
  return {
    total: tasks.length,
    running: tasks.filter((task) => queueStatus(task) === 'running').length,
    queued: tasks.filter((task) => queueStatus(task) === 'queued').length,
    success: tasks.filter((task) => queueStatus(task) === 'success').length,
    failed: tasks.filter((task) => queueStatus(task) === 'failed').length,
    cancelled: tasks.filter((task) => queueStatus(task) === 'cancelled').length,
    unknown: tasks.filter((task) => queueStatus(task) === 'unknown').length
  }
}
