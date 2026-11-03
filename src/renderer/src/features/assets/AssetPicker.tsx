import { SelectOption } from '@/components/ui/select-field'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select-field'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTableCells, faList, faArrowsLeftRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { Checkbox } from '@/components/ui/checkbox'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useLibrary } from './use-library'
import { AssetMedia } from './AssetMedia'
import { folderPath, isWithinFolder } from './folders'
import { FolderNavigation } from './FolderNavigation'

export function AssetPicker({ projectId, onClose, onPick, onPickMany, requiredKind, replacing = false }: {
  projectId: string | null; onClose: () => void; onPick: (asset: Asset) => Promise<void>; requiredKind?: Asset['kind']; replacing?: boolean
  onPickMany?: (assets: Asset[]) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [kind, setKind] = useState('all')
  const [view, setView] = useState<'tiles' | 'details'>('tiles')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Asset[]>([])
  const multiple = Boolean(onPickMany) && !replacing
  const toggle = (asset: Asset) => setSelected((current) => current.some((item) => item.id === asset.id)
    ? current.filter((item) => item.id !== asset.id) : [...current, asset])
  const [source, setSource] = useState<'project' | 'public'>(projectId ? 'project' : 'public')
  // 必须显式传 null 或当前项目 ID；undefined 会让素材与分类查询退回全项目范围。
  const scopeId = source === 'public' ? null : projectId
  const library = useLibrary({ projectId: scopeId, search })
  const categories = (library.categories.data ?? []).filter((folder) => folder.projectId === scopeId)
  const selectedCategory = categories.some((folder) => folder.id === category) ? category : category === 'none' ? 'none' : 'all'
  const assets = (library.assets.data ?? []).filter((asset) => asset.projectId === scopeId && !asset.archived &&
    (selectedCategory === 'all' || (selectedCategory === 'none' ? asset.categoryId === null : asset.categoryId !== null && isWithinFolder(categories, asset.categoryId, selectedCategory))) && (requiredKind ? asset.kind === requiredKind : kind === 'all' || asset.kind === kind))
  return <Dialog title={replacing ? '替换引用素材' : '选择素材'} className="asset-picker-dialog" onClose={() => { if (!busy) onClose() }}>
    <ToggleGroup type="single" value={source} aria-label="素材来源" disabled={busy} onValueChange={(value) => {
      if (value !== 'project' && value !== 'public') return
      setSource(value); setCategory('all'); setError('')
    }}><ToggleGroupItem value="project" disabled={!projectId}>当前项目</ToggleGroupItem><ToggleGroupItem value="public">公共素材</ToggleGroupItem></ToggleGroup>
    <div className={`asset-picker-layout${multiple ? ' asset-picker-multiple' : ''}`}><aside className="asset-picker-folders">
      <FolderNavigation key={`${source}-${projectId}`} categories={categories} selected={selectedCategory} onSelect={(id) => { if (!busy) setCategory(id) }} dropTarget={null} busy />
    </aside><section className="asset-picker-results" aria-label="可引用素材">
    <div className="asset-picker-filters"><Input aria-label="搜索当前来源素材" placeholder="搜索名称、标签、提示词" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} />
      <SelectField aria-label="素材类型" value={requiredKind ?? kind} disabled={busy || Boolean(requiredKind)} onChange={(event) => setKind(event.target.value)}><SelectOption value="all">全部类型</SelectOption><SelectOption value="image">图片</SelectOption><SelectOption value="video">视频</SelectOption><SelectOption value="audio">音频</SelectOption><SelectOption value="prompt">提示词</SelectOption></SelectField></div>
    <div className="asset-picker-location"><span>{source === 'public' ? '公共素材' : '当前项目'} / {selectedCategory === 'all' ? '全部素材' : folderPath(categories, selectedCategory === 'none' ? null : selectedCategory)}</span><span>{library.assets.isPending ? '读取中' : library.assets.error ? '读取失败' : `${assets.length} 项`}</span></div>
    {(error || library.assets.error || library.categories.error) && <p role="alert" className="field-error">{error || library.assets.error?.message || library.categories.error?.message}</p>}
    <div className="asset-picker-viewbar"><ToggleGroup type="single" value={view} aria-label="素材显示方式" onValueChange={(value) => { if (value === 'tiles' || value === 'details') setView(value) }}>
      <ToggleGroupItem value="tiles" title="宫格" aria-label="宫格"><FontAwesomeIcon icon={faTableCells} /></ToggleGroupItem>
      <ToggleGroupItem value="details" title="列表" aria-label="列表"><FontAwesomeIcon icon={faList} /></ToggleGroupItem>
    </ToggleGroup></div>
    <div className={`asset-picker-items ${view === 'tiles' ? 'asset-picker-tiles' : ''}`}>{assets.map((asset) => <article className="asset-picker-item" key={asset.id}>
      <div className="asset-picker-media"><AssetMedia asset={asset} compact /></div><div className="asset-picker-info"><strong title={asset.name}>{asset.name}</strong><span className="muted">{folderPath(categories, asset.categoryId)}</span>{asset.tags.length > 0 && <span className="muted">{asset.tags.join(' · ')}</span>}</div>
      {multiple && asset.kind !== 'prompt' ? <label className="asset-picker-select"><Checkbox disabled={busy} checked={selected.some((item) => item.id === asset.id)} onCheckedChange={() => toggle(asset)} aria-label={`选择 ${asset.name}`} />选择</label> : <Button variant="outline" size="small" disabled={busy || multiple && selected.length > 0} title={replacing ? '替换引用素材' : asset.kind === 'prompt' ? '插入提示词' : '关联素材'} onClick={() => {
        if (asset.projectId !== null && asset.projectId !== projectId) { setError('只能引用当前项目或公共素材'); return }
        setBusy(true); setError('')
        void onPick(asset).then(onClose).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : '添加失败')).finally(() => setBusy(false))
      }}><FontAwesomeIcon icon={replacing ? faArrowsLeftRight : faPlus} />{replacing ? '替换' : asset.kind === 'prompt' ? '插入' : '引用'}</Button>}</article>)}</div>
    {library.assets.isPending ? <div className="queue-empty">正在读取素材</div> : !library.assets.error && assets.length === 0 && <div className="queue-empty">暂无符合条件的素材</div>}
    </section>{multiple && <aside className="asset-picker-selected" aria-label="已选素材"><strong>已选素材（{selected.length}）</strong>
      <div className="asset-picker-selected-items">{selected.map((asset) => <div className="asset-picker-selected-item" key={asset.id}>
        <div className="asset-picker-media"><AssetMedia asset={asset} compact /></div><span title={asset.name}>{asset.name}</span>
        <Button variant="ghost" size="icon" disabled={busy} title={`移除 ${asset.name}`} aria-label={`移除 ${asset.name}`} onClick={() => toggle(asset)}><FontAwesomeIcon icon={faXmark} /></Button>
      </div>)}</div>
      <Button disabled={busy || selected.length === 0} onClick={() => {
        setBusy(true); setError('')
        void onPickMany?.(selected).then(onClose).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : '引用失败')).finally(() => setBusy(false))
      }}>{busy ? '引用中' : `引用已选（${selected.length}）`}</Button>
    </aside>}</div>
  </Dialog>
}
