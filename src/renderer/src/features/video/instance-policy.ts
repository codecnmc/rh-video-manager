import type { VideoDraft } from '../../../../shared/contracts/video'

export function selectInstanceTier(draft: Pick<VideoDraft, 'duration' | 'instance' | 'instanceMode'>, imageCount: number): VideoDraft['instance'] {
  if (draft.instanceMode !== 'auto') return draft.instance
  return draft.duration > 5 || imageCount > 3 ? 'plus' : 'default'
}
