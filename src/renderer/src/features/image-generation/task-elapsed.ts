import type { ImageNode } from '@contracts/image-generation'

export function imageTaskElapsed(node: ImageNode | null, now: number): string {
  if (!node?.submittedAt) return node?.status === 'preparing' ? '准备请求中' : node?.status === 'queued' ? '等待调度' : '尚未发送'
  const end = node.finishedAt ? Date.parse(node.finishedAt) : now
  const milliseconds = Math.max(0, end - Date.parse(node.submittedAt))
  if (!Number.isFinite(milliseconds)) return '耗时未知'
  const duration = milliseconds < 1000 ? `${milliseconds} 毫秒` : `${Math.floor(milliseconds / 1000)} 秒`
  return `${node.status === 'acceptance_unknown' ? '请求中断于 ' : ''}${duration}`
}
