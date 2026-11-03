import type { AssetCategory } from '@contracts/assets'

export function folderPath(categories: AssetCategory[], id: string | null): string {
  const names: string[] = []
  const visited = new Set<string>()
  let current = id
  while (current && !visited.has(current)) {
    visited.add(current)
    const folder = categories.find((item) => item.id === current)
    if (!folder) break
    names.unshift(folder.name)
    current = folder.parentId
  }
  return names.join(' / ') || '根目录'
}

export function folderOptions(categories: AssetCategory[]) {
  return categories.map((folder) => ({ ...folder, path: folderPath(categories, folder.id) }))
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
}

export function isWithinFolder(categories: AssetCategory[], id: string, ancestorId: string): boolean {
  const visited = new Set<string>()
  let current: string | null = id
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true
    visited.add(current)
    current = categories.find((item) => item.id === current)?.parentId ?? null
  }
  return false
}
