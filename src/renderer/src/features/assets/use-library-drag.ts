import { useRef, useState, type DragEvent } from 'react'
import type { Asset, AssetCategory } from '@contracts/assets'
import { isWithinFolder } from './folders'

export type AssetMoveItem = { id: string; expectedUpdatedAt: string }
type Payload = { kind: 'assets'; items: AssetMoveItem[] } | { kind: 'folder'; folder: AssetCategory }

export function canDropFolder(categories: AssetCategory[], source: AssetCategory, target: string | null): boolean {
  return source.parentId !== target && (target === null || (categories.find((folder) => folder.id === target)?.projectId === source.projectId && !isWithinFolder(categories, target, source.id)))
}

export function useLibraryDrag({ assets, categories, selected, busy, onSelect, onMoveAssets, onMoveFolder, onImportFiles }: {
  assets: Asset[]; categories: AssetCategory[]; selected: string[]; busy: boolean; onSelect: (ids: string[]) => void
  onMoveAssets: (items: AssetMoveItem[], target: string | null) => void
  onMoveFolder: (folder: AssetCategory, target: string | null) => void
  onImportFiles: (files: File[], target: string | null) => void
}) {
  const payload = useRef<Payload | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  function target(event: DragEvent): string | undefined {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-folder-id]') : null
    const id = node?.dataset.folderId
    if (!node || !event.currentTarget.contains(node) || !id || id === 'all') return undefined
    return id
  }
  function valid(id: string, external: boolean): boolean {
    if (busy || (id !== 'none' && !categories.some((folder) => folder.id === id))) return false
    const destination = id === 'none' ? null : id
    const current = payload.current
    if (!current) return external
    if (current.kind === 'folder') return canDropFolder(categories, current.folder, destination)
    const folder = categories.find((item) => item.id === destination)
    return (destination === null || current.items.every((item) => assets.find((asset) => asset.id === item.id)?.projectId === folder?.projectId)) &&
      current.items.some((item) => assets.find((asset) => asset.id === item.id)?.categoryId !== destination)
  }
  function clear() { payload.current = null; setDropTarget(null) }
  return { dropTarget,
    onDragStart: (event: DragEvent) => {
      if (busy) { event.preventDefault(); return }
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-asset-id], [data-draggable-folder]') : null
      const asset = assets.find((item) => item.id === node?.dataset.assetId)
      const folder = categories.find((item) => item.id === node?.dataset.draggableFolder)
      if (asset) {
        const items = selected.includes(asset.id) ? assets.filter((item) => selected.includes(item.id)) : [asset]
        if (items.length > 200) { event.preventDefault(); return }
        onSelect(items.map((item) => item.id))
        payload.current = { kind: 'assets', items: items.map((item) => ({ id: item.id, expectedUpdatedAt: item.updatedAt })) }
      } else if (folder) payload.current = { kind: 'folder', folder: { ...folder } }
      else { event.preventDefault(); return }
      // 只接受本次窗口内存中的拖拽快照，不解析外部提供的素材 ID 或磁盘路径。
      event.dataTransfer.setData('application/x-workbench-assets', 'move')
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (event: DragEvent) => {
      const id = target(event)
      const external = event.dataTransfer.types.includes('Files')
      if (external) event.preventDefault()
      if (id === undefined || !valid(id, external)) { setDropTarget(null); event.dataTransfer.dropEffect = 'none'; return }
      event.preventDefault(); event.dataTransfer.dropEffect = payload.current ? 'move' : 'copy'; setDropTarget(id)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const id = target(event)
      const files = Array.from(event.dataTransfer.files)
      const current = payload.current
      const allowed = id !== undefined && valid(id, files.length > 0)
      clear()
      if (!allowed || id === undefined) return
      const destination = id === 'none' ? null : id
      if (current?.kind === 'assets') onMoveAssets(current.items, destination)
      else if (current?.kind === 'folder') onMoveFolder(current.folder, destination)
      else if (files.length) onImportFiles(files, destination)
    },
    onDragLeave: (event: DragEvent) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null) },
    onDragEnd: clear
  }
}
