import { useState, type MouseEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolder, faImage, faVideo, faMusic, faFileLines, faList, faTableCells, faArrowDown, faArrowUp } from '@fortawesome/free-solid-svg-icons'
import type { Asset, AssetCategory } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { AssetMedia } from './AssetMedia'
import { folderPath } from './folders'
import { useAssetView } from './use-asset-view'

const kindLabels = { image: '图片', video: '视频', audio: '音频', prompt: '提示词' }
const kindIcons = { image: faImage, video: faVideo, audio: faMusic, prompt: faFileLines }
type Sort = 'name' | 'updatedAt' | 'kind' | 'size'

export function AssetBrowser({ assets, folders, categories, selected, onSelect, onOpenFolder, onOpenAsset, busy, dropTarget, onPresentationChange }: {
  assets: Asset[]; folders: AssetCategory[]; categories: AssetCategory[]; selected: string[]
  onSelect: (ids: string[]) => void; onOpenFolder: (id: string) => void; onOpenAsset: (asset: Asset) => void; busy: boolean
  dropTarget: string | null
  onPresentationChange: () => void
}) {
  const presentation = useAssetView()
  const { view } = presentation
  const [sort, setSort] = useState<Sort>('name')
  const [descending, setDescending] = useState(false)
  const [anchor, setAnchor] = useState<string | null>(null)
  const ordered = [...assets].sort((left, right) => {
    const compared = sort === 'size' ? left.size - right.size : left[sort].localeCompare(right[sort], 'zh-CN', { numeric: true })
    return (descending ? -compared : compared) || left.id.localeCompare(right.id)
  })
  const orderedFolders = [...folders].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
  function select(asset: Asset, event: MouseEvent) {
    if (busy) return
    if (event.shiftKey && anchor && ordered.some((item) => item.id === anchor)) {
      const from = ordered.findIndex((item) => item.id === anchor)
      const to = ordered.findIndex((item) => item.id === asset.id)
      const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id)
      onSelect(event.ctrlKey || event.metaKey ? [...new Set([...selected, ...range])] : range)
    } else {
      onSelect(event.ctrlKey || event.metaKey ? selected.includes(asset.id) ? selected.filter((id) => id !== asset.id) : [...selected, asset.id] : [asset.id])
      setAnchor(asset.id)
    }
  }
  function sortBy(value: Sort) { onPresentationChange(); if (sort === value) setDescending(!descending); else { setSort(value); setDescending(false) } }
  const heading = (value: Sort, label: string) => <Button variant="unstyled" onClick={() => sortBy(value)}>{label}{sort === value && <FontAwesomeIcon icon={descending ? faArrowDown : faArrowUp} />}</Button>
  const toggle = (id: string) => onSelect(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  if (presentation.loading) return <div className="queue-empty">正在读取显示偏好</div>
  return <div className="asset-browser">
    {presentation.error && <p className="field-error" role="alert">显示偏好保存或读取失败：{presentation.error}</p>}
    <div className="asset-browser-viewbar"><span>{folders.length} 个文件夹 · {assets.length} 个素材</span>
      <ToggleGroup type="single" value={view} disabled={presentation.disabled} onValueChange={(value) => { if (value === 'details' || value === 'tiles') { onPresentationChange(); presentation.setView(value) } }} aria-label="素材显示方式">
        <ToggleGroupItem value="details" title="详细信息" aria-label="详细信息"><FontAwesomeIcon icon={faList} /></ToggleGroupItem>
        <ToggleGroupItem value="tiles" title="缩略图" aria-label="缩略图"><FontAwesomeIcon icon={faTableCells} /></ToggleGroupItem>
      </ToggleGroup></div>
    {view === 'details' ? <Table className="asset-file-table"><TableHeader><TableRow>
      <TableHead className="asset-selection-cell"><Checkbox aria-label="选择全部素材" disabled={busy || !assets.length} checked={selected.length === assets.length && assets.length > 0 ? true : selected.length ? 'indeterminate' : false}
        onCheckedChange={(checked) => onSelect(checked ? assets.map((asset) => asset.id) : [])} /></TableHead>
      <TableHead aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : undefined}>{heading('name', '名称')}</TableHead>
      <TableHead aria-sort={sort === 'updatedAt' ? descending ? 'descending' : 'ascending' : undefined}>{heading('updatedAt', '修改日期')}</TableHead>
      <TableHead>{heading('kind', '类型')}</TableHead><TableHead>{heading('size', '大小')}</TableHead>
    </TableRow></TableHeader><TableBody>
      {orderedFolders.map((folder) => <TableRow key={folder.id} draggable={!busy} data-draggable-folder={folder.id} data-folder-id={folder.id} data-drop-active={dropTarget === folder.id}><TableCell /><TableCell colSpan={4}>
        <Button variant="unstyled" className="asset-file-name" onClick={() => onOpenFolder(folder.id)}><FontAwesomeIcon icon={faFolder} className="asset-directory-icon" /><span>{folder.name}</span></Button>
      </TableCell></TableRow>)}
      {ordered.map((asset) => <TableRow key={asset.id} draggable={!busy} data-asset-id={asset.id} aria-selected={selected.includes(asset.id)} data-selected={selected.includes(asset.id)} onClick={(event) => select(asset, event)} onDoubleClick={() => { if (!busy) onOpenAsset(asset) }}>
        <TableCell className="asset-selection-cell" onClick={(event) => event.stopPropagation()}><Checkbox disabled={busy} aria-label={`选择 ${asset.name}`} checked={selected.includes(asset.id)} onCheckedChange={() => { toggle(asset.id); setAnchor(asset.id) }} /></TableCell>
        <TableCell><Button variant="unstyled" className="asset-file-name" title={`${asset.name}\n${folderPath(categories, asset.categoryId)}`} disabled={busy} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.stopPropagation(); onOpenAsset(asset) }
        }}><FontAwesomeIcon icon={kindIcons[asset.kind]} /><span>{asset.name}</span></Button>{asset.imageGeneration && <small className="muted">生成账号：{asset.imageGeneration.accountName}</small>}</TableCell>
        <TableCell className="asset-file-date">{new Date(asset.updatedAt).toLocaleString('zh-CN', { hour12: false })}</TableCell><TableCell>{kindLabels[asset.kind]}</TableCell>
        <TableCell>{asset.kind === 'prompt' ? `${asset.prompt.length} 字` : formatSize(asset.size)}</TableCell>
      </TableRow>)}
    </TableBody></Table> : <div className="asset-file-tiles">
      {orderedFolders.map((folder) => <Button key={folder.id} variant="unstyled" draggable={!busy} data-draggable-folder={folder.id} data-folder-id={folder.id} data-drop-active={dropTarget === folder.id} className="asset-directory-tile" onClick={() => onOpenFolder(folder.id)}><div className="asset-tile-media"><FontAwesomeIcon icon={faFolder} /></div><span>{folder.name}</span></Button>)}
      {ordered.map((asset) => <div key={asset.id} draggable={!busy} data-asset-id={asset.id} className="asset-file-tile" data-selected={selected.includes(asset.id)} onClick={(event) => select(asset, event)} onDoubleClick={() => { if (!busy) onOpenAsset(asset) }}>
        <div className="asset-tile-selection" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`选择 ${asset.name}`} disabled={busy} checked={selected.includes(asset.id)} onCheckedChange={() => toggle(asset.id)} /></div>
        <Button variant="unstyled" disabled={busy} className="asset-tile-content" title={asset.name} onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onOpenAsset(asset) } }}>
          <div className="asset-tile-media">{asset.kind === 'audio' ? <FontAwesomeIcon icon={faMusic} /> : <AssetMedia asset={asset} compact />}</div><span>{asset.name}</span>
        </Button>{asset.imageGeneration && <small className="muted">生成账号：{asset.imageGeneration.accountName}</small>}
      </div>)}
    </div>}
    {!assets.length && !folders.length && <div className="queue-empty">此文件夹为空</div>}
  </div>
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
