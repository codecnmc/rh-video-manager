import type { PreviewSnapshot } from '@contracts/preview'

export function visibleEarlyPreviews(preview: Pick<PreviewSnapshot, 'capabilities' | 'sampling' | 'draft'> | undefined): ('sampling' | 'draft')[] {
  if (!preview) return []
  // 使用该任务的能力快照，不能用当前线上工作流改写历史任务的显示。
  return (['sampling', 'draft'] as const).filter((kind) => preview.capabilities.status === 'ready'
    ? preview.capabilities[kind] === true : Boolean(preview[kind]))
}
