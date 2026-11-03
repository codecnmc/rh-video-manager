import type { ImageNode } from '@contracts/image-generation'

export function canRegenerateImageTask(node: Pick<ImageNode, 'status'>): boolean {
  return ['saved', 'resolved', 'output_unavailable'].includes(node.status)
}

export function latestImageTaskIds(nodes: ImageNode[]): Set<string> {
  const latest = new Map<string, ImageNode>()
  for (const node of nodes) {
    const root = imageVersionRoot(node.id, nodes)
    const previous = latest.get(root)
    if (!previous || node.createdAt >= previous.createdAt) latest.set(root, node)
  }
  return new Set([...latest.values()].map((node) => node.id))
}

export function imageVersionRoot(id: string, nodes: ImageNode[]): string {
  const visited = new Set<string>()
  let current = id
  while (!visited.has(current)) {
    visited.add(current)
    const source = nodes.find((node) => node.id === current)?.sourceNodeId
    if (!source) return current
    current = source
  }
  return id
}

export function imageTaskVersions(id: string, nodes: ImageNode[]): ImageNode[] {
  const root = imageVersionRoot(id, nodes)
  return nodes.filter((node) => imageVersionRoot(node.id, nodes) === root)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export function imageRetryHasUnknownHistory(node: ImageNode, nodes: ImageNode[]): boolean {
  const visited = new Set<string>()
  let source = node.sourceNodeId
  while (source && !visited.has(source)) {
    visited.add(source)
    const parent = nodes.find((item) => item.id === source)
    if (parent?.status === 'resolved') return true
    source = parent?.sourceNodeId
  }
  return false
}
