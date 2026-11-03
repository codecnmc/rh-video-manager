import type { ImageNode } from '../../../../shared/contracts/image-generation'

export function occupiesImageCapacity(node: ImageNode): boolean {
  return ['preparing', 'generating', 'acceptance_unknown'].includes(node.status)
}

export function isImageDraft(node: ImageNode): boolean {
  return node.status === 'draft' || node.status === 'not_submitted'
}
