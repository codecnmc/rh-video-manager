import type { ImageBoard, ImageNode } from '@contracts/image-generation'

export type CanvasLayout = Pick<ImageBoard, 'positions' | 'hiddenNodeIds'>
export type CanvasPoint = { x: number; y: number }
export type CanvasTask = Pick<ImageNode, 'id' | 'title' | 'prompt' | 'size' | 'accountId' | 'references' | 'status' | 'accountSnapshot' | 'assetId' | 'review'> & { unsaved?: boolean }

export function canvasLayout(board: ImageBoard): CanvasLayout {
  return { positions: board.positions, hiddenNodeIds: board.hiddenNodeIds }
}

export function editableImageTask(task: Pick<ImageNode, 'status'>): boolean {
  return task.status === 'draft' || task.status === 'not_submitted'
}

export function removeCanvasItems(layout: CanvasLayout, ids: string[]): CanvasLayout {
  return { ...layout, hiddenNodeIds: [...new Set([...layout.hiddenNodeIds, ...ids])] }
}

export function placeCanvasItems(layout: CanvasLayout, ids: string[], point: CanvasPoint): CanvasLayout {
  const positions = { ...layout.positions }
  ids.forEach((id, index) => {
    positions[id] = { x: Math.max(-100000, Math.min(100000, point.x + index % 3 * 300)),
      y: Math.max(-100000, Math.min(100000, point.y + Math.floor(index / 3) * 290)) }
  })
  return { positions, hiddenNodeIds: layout.hiddenNodeIds.filter((id) => !ids.includes(id)) }
}
