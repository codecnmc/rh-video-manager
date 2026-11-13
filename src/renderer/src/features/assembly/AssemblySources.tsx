import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faRotateRight, faUpload, faMagnifyingGlass, faMusic, faVideo, faTriangleExclamation, faXmark, faCheck } from '@fortawesome/free-solid-svg-icons'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PreviewVideoPlayer } from '@/shared/components/PreviewVideoPlayer'
import { mediaSource } from './use-assembly'
import { timecode } from './assembly-state'
import { useAssemblyPlaybackLease } from './AssemblyPlaybackScope'

export const assemblyAssetDragType = 'application/x-workbench-assembly-asset'

export function AssemblySources({ assets, loading, error, disabled, importing, selected, used, onSelect, onAdd, onReload, onImport }: {
  assets: Asset[]; loading: boolean; error?: string | undefined; disabled: boolean; importing: boolean
  selected: string | undefined; used: Set<string>; onSelect: (asset: Asset) => void
  onAdd: (asset: Asset) => void; onReload: () => void; onImport: (kind: 'video' | 'audio') => void
}) {
  const [kind, setKind] = useState<'video' | 'audio'>('video')
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('all')
  const media = assets.filter((asset) => asset.kind === kind && (scope === 'all' || (scope === 'project' ? asset.projectId !== null : asset.projectId === null))
    && `${asset.name} ${asset.tags.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="assembly-sources" aria-label="剪辑素材">
    <div className="assembly-pane-heading"><h2>素材</h2><div className="assembly-source-actions">
      <Button variant="ghost" size="icon" title="刷新素材" aria-label="刷新素材" disabled={disabled} onClick={onReload}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Button disabled={disabled} onClick={() => onImport(kind)}><FontAwesomeIcon icon={faUpload} />{importing ? '正在导入' : '导入'}</Button>
    </div></div>
    <div className="assembly-source-layout"><aside className="assembly-source-categories" aria-label="素材分类">
      <div className="assembly-source-kind" role="group" aria-label="素材类型">{(['video', 'audio'] as const).map((value) => <Button variant="unstyled" aria-pressed={kind === value} key={value} onClick={() => setKind(value)}><FontAwesomeIcon icon={value === 'video' ? faVideo : faMusic} />{value === 'video' ? '视频' : '声音'}<span>{assets.filter((asset) => asset.kind === value).length}</span></Button>)}</div>
      <div className="assembly-source-scopes" role="group" aria-label="素材范围">{([{ id: 'all', label: '全部素材' }, { id: 'project', label: '项目素材' }, { id: 'public', label: '公共素材' }] as const).map((item) => <Button variant="unstyled" key={item.id} aria-pressed={scope === item.id} onClick={() => setScope(item.id)}>{item.label}</Button>)}</div>
    </aside><div className="assembly-source-content">
    <div className="assembly-source-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><Input aria-label="搜索素材" placeholder="搜索名称或标签" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="assembly-source-filter"><span>{scope === 'project' ? '项目素材' : scope === 'public' ? '公共素材' : '全部素材'} · {kind === 'video' ? '视频' : '声音'}</span><span>{media.length} 项</span></div>
    {error && <div role="alert" className="field-error">{error}</div>}
    <div className="assembly-source-list" aria-busy={loading}>{media.map((asset) => <SourceCard key={`${asset.id}-${asset.updatedAt}`} asset={asset} selected={selected === asset.id} used={used.has(asset.id)} disabled={disabled} onSelect={() => onSelect(asset)} onAdd={() => onAdd(asset)} />)}
      {!media.length && <div className="assembly-subtle-empty"><FontAwesomeIcon icon={kind === 'video' ? faVideo : faMusic} /><span>{loading ? '正在读取素材' : search || scope !== 'all' ? '暂无匹配素材' : kind === 'video' ? '暂无视频素材' : '暂无声音素材'}</span>{!loading && !search && scope === 'all' && <Button variant="outline" disabled={disabled} onClick={() => onImport(kind)}><FontAwesomeIcon icon={faPlus} />{kind === 'video' ? '导入视频' : '导入音频'}</Button>}</div>}
    </div></div></div>
  </section>
}

function SourceCard({ asset, selected, used, disabled, onSelect, onAdd }: {
  asset: Asset; selected: boolean; used: boolean; disabled: boolean; onSelect: () => void; onAdd: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // 只为进入素材视口的卡片加载媒体，避免一次打开大量本地解码器。
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: root.current?.closest('.assembly-source-list') ?? null, rootMargin: '80px' })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  function readDuration(element: HTMLMediaElement) {
    if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration)
  }
  return <div ref={root} className={`assembly-source-card${selected ? ' selected' : ''}`} draggable={!disabled && !failed} onDragStart={(event) => {
    if (disabled || failed) { event.preventDefault(); return }
    event.dataTransfer.setData(assemblyAssetDragType, asset.id); event.dataTransfer.effectAllowed = 'copy'
  }}>
    <button type="button" className="assembly-source-select" aria-label={`预览：${asset.name}`} aria-pressed={selected} onClick={onSelect}>
      <div className={`assembly-source-cover${asset.kind === 'audio' ? ' is-audio' : ''}`}>
        {failed ? <span className="assembly-source-unavailable"><FontAwesomeIcon icon={faTriangleExclamation} />文件不可用</span> : asset.kind === 'video' ? <>{visible && <video src={mediaSource(asset.id)} muted playsInline preload="auto" onLoadedMetadata={(event) => { readDuration(event.currentTarget); event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2) }} onError={() => setFailed(true)} />}</> : <><FontAwesomeIcon icon={faMusic} />{visible && <audio src={mediaSource(asset.id)} preload="metadata" onLoadedMetadata={(event) => readDuration(event.currentTarget)} onError={() => setFailed(true)} />}</>}
        {duration !== null && <span className="assembly-source-duration">{timecode(duration)}</span>}
        {used && <span className="assembly-source-used" title="已在当前时间轴使用"><FontAwesomeIcon icon={faCheck} />已使用</span>}
      </div>
      <strong title={asset.name}>{asset.name}</strong><small>{asset.projectId ? '项目素材' : '公共素材'}</small>
    </button>
    <Button className="assembly-source-add" size="icon" title={`添加到时间轴：${asset.name}`} aria-label={`添加到时间轴：${asset.name}`} disabled={disabled || failed} onClick={onAdd}><FontAwesomeIcon icon={faPlus} /></Button>
  </div>
}

export function AssemblySourcePreview({ asset, onClose, active = true }: { asset: Asset; onClose: () => void; active?: boolean }) {
  const [failed, setFailed] = useState(false)
  const preview = useRef<HTMLElement>(null)
  useEffect(() => setFailed(false), [asset.id])
  const claimPlayback = useAssemblyPlaybackLease(() => preview.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => element.pause()))
  useEffect(() => {
    const container = preview.current
    return () => container?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => element.pause())
  }, [])
  useEffect(() => {
    if (!active) preview.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => element.pause())
  }, [active])
  return <section ref={preview} className="assembly-preview assembly-source-preview">
    <div className="assembly-pane-heading"><h2>素材预览</h2><Button variant="outline" onClick={onClose}><FontAwesomeIcon icon={faXmark} />返回时间轴</Button></div>
    <div className="assembly-preview-stage">{failed ? <div className="assembly-preview-empty" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} /><span>素材不可用或格式不受支持</span></div> : asset.kind === 'video' ? <PreviewVideoPlayer key={asset.id} source={mediaSource(asset.id)} sampling={false} label={asset.name} onDuration={() => {}} onPlay={claimPlayback} onError={() => setFailed(true)} /> : <div className="assembly-source-audio-preview"><FontAwesomeIcon icon={faMusic} /><audio src={mediaSource(asset.id)} controls preload="metadata" onPlay={claimPlayback} onError={() => setFailed(true)} /></div>}</div>
    <div className="assembly-preview-caption"><strong>{asset.name}</strong><span className="muted">{asset.projectId ? '项目素材' : '公共素材'}</span></div>
  </section>
}
