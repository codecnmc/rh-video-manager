export type SelectionPoint = { x: number; y: number }
export type SelectionRect = { left: number; top: number; width: number; height: number }

export function selectionRect(start: SelectionPoint, end: SelectionPoint): SelectionRect {
  return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

export function intersectsSelection(left: SelectionRect, right: SelectionRect): boolean {
  return left.left < right.left + right.width && left.left + left.width > right.left && left.top < right.top + right.height && left.top + left.height > right.top
}

export function marqueeSelection(initial: string[], hits: string[], toggle: boolean): string[] {
  if (!toggle) return hits
  // Ctrl 框选始终以按下时的快照做异或，避免移动事件反复翻转同一素材。
  const hitSet = new Set(hits)
  const initialSet = new Set(initial)
  return [...initial.filter((id) => !hitSet.has(id)), ...hits.filter((id) => !initialSet.has(id))]
}

export function edgeScrollSpeed(position: number, extent: number): number {
  const edge = Math.min(36, extent / 3)
  if (edge <= 0) return 0
  if (position < edge) return -Math.min(1, (edge - position) / edge) * 720
  if (position > extent - edge) return Math.min(1, (position - extent + edge) / edge) * 720
  return 0
}
