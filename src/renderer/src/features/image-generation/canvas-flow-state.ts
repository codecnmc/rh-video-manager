import type { Node } from '@xyflow/react'

export function reconcileCanvasNodes<T extends Node>(previous: T[], incoming: T[]): T[] {
  const existing = new Map(previous.map((node) => [node.id, node]))
  return incoming.map((node) => {
    const current = existing.get(node.id)
    if (!current) return node
    // 业务快照不含 React Flow 测量尺寸；重建时必须保留，否则拖动中的节点会退回未初始化状态。
    return { ...current, ...node, position: current.dragging ? current.position : node.position }
  })
}

export function applyCanvasSelection(previous: string[], changes: { id: string; selected: boolean }[]): string[] {
  const next = new Set(previous)
  for (const change of changes) {
    if (change.selected) next.add(change.id)
    else next.delete(change.id)
  }
  return next.size === previous.length && previous.every((id) => next.has(id)) ? previous : [...next]
}
