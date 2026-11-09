import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faVolumeXmark, faHeadphones, faLock, faLockOpen, faArrowsLeftRight } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyVersion, AssemblyTrack } from '@contracts/assembly'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { timelineClips, timecode, soundKinds, soundStates } from './assembly-state'
import { soundStart, totalDuration } from '../../../../shared/assembly-timing'
import { useTimelineGesture } from './use-timeline-gesture'
import { assemblyAssetDragType } from './AssemblySources'
import { AssemblyWaveform } from './AssemblyWaveform'
import { assemblyTransitions } from '../../../../shared/assembly-transitions'

interface TimelineProps {
  version: AssemblyVersion; selected?: string | undefined; selectedSound: string | null; selectedCaption: string | null
  zoom: number; position: number; snapping: boolean; disabled: boolean; assets: Asset[]
  onChange: (version: AssemblyVersion) => void; onSeek: (time: number) => void; onSelect: (id: string) => void
  onSelectSound: (id: string) => void; onSelectCaption: (id: string) => void
  onReorder: (source: string, target: string, after: boolean) => void
  onAddAudio: (asset: Asset, time: number, trackId?: string) => void
  onAddVideo: (asset: Asset, beforeId?: string) => void
}
export function AssemblyTimeline(props: TimelineProps) {
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const caption = props.version.captions?.find((item) => item.id === props.selectedCaption)
    const viewport = scroll.current
    if (!caption || !viewport) return
    // 列表选择也能定位时间轴；仅在选中字幕不在可视范围时横向滚动。
    const start = 180 + caption.start * props.zoom
    const end = 180 + caption.end * props.zoom
    if (start < viewport.scrollLeft + 180 || end > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = Math.max(0, start - 180 - 24)
  }, [props.selectedCaption, props.zoom])
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const gesture = useTimelineGesture(props.version, props.zoom, props.position, props.snapping, props.onChange)
  const version = gesture.version
  const clips = timelineClips(version)
  const end = Math.max(totalDuration(version), ...version.sounds.map((sound) => soundStart(version, sound) + sound.duration), ...(version.captions ?? []).map((caption) => caption.end), 1)
  const width = Math.max(600, end * props.zoom)
  const dragType = 'application/x-workbench-assembly-clip'
  const tracks = version.tracks ?? []
  const unassigned = version.sounds.filter((sound) => !sound.trackId)
  const step = props.zoom >= 70 ? 1 : props.zoom >= 25 ? 5 : 10
  function handle(event: PointerEvent<HTMLElement>, kind: 'clip' | 'sound' | 'caption', id: string, edge: 'in' | 'out' | 'move') {
    if (props.disabled || event.button !== 0) return
    event.currentTarget.focus({ preventScroll: true })
    // 指针捕获会阻止原生点击聚焦，选中必须先于拖拽建立，不能依赖松手后的 click。
    if (kind === 'caption') props.onSelectCaption(id)
    if (kind === 'sound') props.onSelectSound(id)
    if (kind === 'clip') props.onSelect(id)
    gesture.begin(event, kind, id, edge)
  }
  function updateTrack(track: AssemblyTrack, key: 'muted' | 'solo' | 'locked') {
    props.onChange({ ...version, tracks: tracks.map((item) => item.id === track.id ? { ...item, [key]: !item[key] } : item) })
  }
  return <div ref={scroll} className="assembly-timeline-scroll"><div className="assembly-timeline assembly-editable-timeline" style={{ width: width + 180 }}>
    <div className="assembly-playhead" style={{ left: 180 + props.position * props.zoom }} />
    <div className="assembly-track"><span className="assembly-track-name">时间</span><div className="assembly-track-body assembly-ruler">{Array.from({ length: Math.min(2000, Math.ceil(end / step) + 1) }, (_, index) => <span key={index} style={{ left: index * step * props.zoom }}>{timecode(index * step)}</span>)}<input className="assembly-ruler-seek" aria-label="时间轴播放头" type="range" min={0} max={totalDuration(version) || 1} value={Math.min(props.position, totalDuration(version))} step={1 / (version.frameRate ?? 30)} disabled={!clips.length} style={{ width: totalDuration(version) * props.zoom }} onChange={(event) => props.onSeek(Number(event.target.value))} /></div></div>
    <div className="assembly-track"><span className="assembly-track-name">视频 V1</span><div className="assembly-track-body" onDragOver={(event) => { if (!props.disabled && event.dataTransfer.types.includes(assemblyAssetDragType)) { event.preventDefault(); event.stopPropagation() } }} onDrop={(event) => {
      if (props.disabled) return
      const asset = props.assets.find((item) => item.id === event.dataTransfer.getData(assemblyAssetDragType) && item.kind === 'video')
      if (!asset) return
      event.preventDefault(); event.stopPropagation()
      const time = (event.clientX - event.currentTarget.getBoundingClientRect().left) / props.zoom
      const target = clips.find((item) => time < (item.start + item.end) / 2)
      props.onAddVideo(asset, target?.clip.id)
    }}>{clips.map(({ clip, start, end: clipEnd }) => <div key={clip.id} className={`assembly-clip assembly-editable-clip${props.selected === clip.id ? ' selected' : ''}`} style={{ left: start * props.zoom, width: (clipEnd - start) * props.zoom, boxShadow: dropTarget?.id === clip.id ? `inset ${dropTarget.after ? '-' : ''}3px 0 var(--primary)` : undefined }}>
      <button type="button" className="assembly-clip-select" disabled={props.disabled} draggable={!props.disabled} title={`${clip.title} · ${timecode(clip.outPoint - clip.inPoint)}`} aria-pressed={props.selected === clip.id}
        onDragStart={(event) => { event.dataTransfer.setData(dragType, clip.id); event.dataTransfer.effectAllowed = 'move'; props.onSelect(clip.id) }} onDragEnd={() => setDropTarget(null)}
        onDragOver={(event) => { if (props.disabled || !event.dataTransfer.types.includes(dragType)) return; event.preventDefault(); event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: clip.id, after: event.clientX > bounds.left + bounds.width / 2 }) }}
        onDragLeave={() => setDropTarget(null)} onDrop={(event) => { if (props.disabled || !event.dataTransfer.types.includes(dragType)) return; event.preventDefault(); event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); props.onReorder(event.dataTransfer.getData(dragType), clip.id, event.clientX > bounds.left + bounds.width / 2); setDropTarget(null) }}
        onClick={() => { props.onSelect(clip.id); props.onSeek(start) }}><strong>{clip.title}</strong><small>{timecode(clip.inPoint)} – {timecode(clip.outPoint)}</small></button>
      {!clip.visual && (['in', 'out'] as const).map((edge) => <button key={edge} type="button" className={`assembly-trim-handle edge-${edge}`} aria-label={`${clip.title}${edge === 'in' ? '入点' : '出点'}裁剪`} title={edge === 'in' ? '拖动裁剪入点' : '拖动裁剪出点'} disabled={props.disabled} onPointerDown={(event) => handle(event, 'clip', clip.id, edge)} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end} />)}
      <button type="button" className="assembly-clip-position" title="拖动调整时间位置" aria-label={`调整时间位置：${clip.title}`} disabled={props.disabled} onPointerDown={(event) => handle(event, 'clip', clip.id, 'move')} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end}><FontAwesomeIcon icon={faArrowsLeftRight} /></button>
      {clip.transition && <span className="assembly-transition-label">{assemblyTransitions[clip.transition.kind].label} {clip.transition.duration.toFixed(2)}s</span>}
    </div>)}</div></div>
    <div className="assembly-track"><span className="assembly-track-name">原片混合声音</span><div className="assembly-track-body">{clips.filter(({ clip }) => clip.originalAudio).map(({ clip, start }) => <Button variant="unstyled" disabled={props.disabled} className="assembly-original" key={clip.id} style={{ left: start * props.zoom, width: (clip.outPoint - clip.inPoint) * props.zoom }} title="选择片段原声" onClick={() => { props.onSelect(clip.id); props.onSeek(start) }}>原声 · {clip.title}</Button>)}</div></div>
    {[...tracks, ...(unassigned.length || !tracks.length ? [null] : [])].map((track) => <div className={`assembly-track assembly-audio-track${track?.muted ? ' is-muted' : ''}`} key={track?.id ?? 'unassigned'} data-audio-track={track?.id ?? ''}>
      <div className="assembly-track-name"><span title={track?.name}>{track?.name ?? '未分轨声音'}</span>{track && <div className="assembly-track-tools">{(['muted', 'solo', 'locked'] as const).map((key) => <Button key={key} variant="ghost" size="icon" aria-pressed={track[key]} title={{ muted: '轨道静音', solo: '轨道独听', locked: '轨道锁定' }[key]} aria-label={`${track.name}${{ muted: '静音', solo: '独听', locked: '锁定' }[key]}`} disabled={props.disabled || track.locked && key !== 'locked'} onClick={() => updateTrack(track, key)}><FontAwesomeIcon icon={key === 'muted' ? faVolumeXmark : key === 'solo' ? faHeadphones : track.locked ? faLock : faLockOpen} /></Button>)}</div>}</div>
      <div className="assembly-track-body" onDragOver={(event) => { if (event.dataTransfer.types.includes(assemblyAssetDragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = props.disabled || track?.locked ? 'none' : 'copy' } }} onDrop={(event) => {
        if (props.disabled || track?.locked) { event.preventDefault(); event.stopPropagation(); return }
        const asset = props.assets.find((item) => item.id === event.dataTransfer.getData(assemblyAssetDragType) && item.kind === 'audio')
        if (!asset) return
        event.preventDefault(); event.stopPropagation(); props.onAddAudio(asset, Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / props.zoom), track?.id)
      }}>{version.sounds.filter((sound) => track ? sound.trackId === track.id : !sound.trackId).map((sound) => {
        const start = soundStart(version, sound)
        return <div key={sound.id} className={`assembly-sound-block state-${sound.state}${props.selectedSound === sound.id ? ' selected' : ''}`} style={{ left: start * props.zoom, width: sound.duration * props.zoom }}>
          {sound.state === 'bound' && <AssemblyWaveform asset={props.assets.find((asset) => asset.id === sound.assetId)} sourceIn={sound.sourceIn ?? 0} duration={sound.duration} />}
          <button type="button" className="assembly-block-select" disabled={props.disabled || track?.locked} title={`${sound.title} · ${soundStates[sound.state]} · ${soundKinds[sound.kind]}`} aria-pressed={props.selectedSound === sound.id} onClick={() => { props.onSelectSound(sound.id); props.onSeek(start) }} onPointerDown={(event) => { if (!track?.locked) handle(event, 'sound', sound.id, 'move') }} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end}>{sound.title}</button>
          {(['in', 'out'] as const).map((edge) => <button key={edge} type="button" className={`assembly-trim-handle edge-${edge}`} aria-label={`${sound.title}${edge === 'in' ? '入点' : '出点'}`} disabled={props.disabled || track?.locked} onPointerDown={(event) => handle(event, 'sound', sound.id, edge)} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end} />)}
        </div>
      })}</div></div>)}
    <div className="assembly-track assembly-caption-track"><span className="assembly-track-name">字幕</span><div className="assembly-track-body">{(version.captions ?? []).map((caption) => <div key={caption.id} className={`assembly-caption-block${props.selectedCaption === caption.id ? ' selected' : ''}`} style={{ left: caption.start * props.zoom, width: (caption.end - caption.start) * props.zoom }}>
      <button type="button" className="assembly-block-select" disabled={props.disabled} title={caption.text} aria-pressed={props.selectedCaption === caption.id} onClick={(event) => { if (event.detail === 0) props.onSelectCaption(caption.id) }} onPointerDown={(event) => handle(event, 'caption', caption.id, 'move')} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end}>{caption.text}</button>
      {(['in', 'out'] as const).map((edge) => <button key={edge} type="button" className={`assembly-trim-handle edge-${edge}`} aria-label={`字幕${edge === 'in' ? '开始' : '结束'}`} disabled={props.disabled} onPointerDown={(event) => handle(event, 'caption', caption.id, edge)} onPointerMove={gesture.move} onPointerUp={gesture.end} onPointerCancel={gesture.end} />)}
    </div>)}</div></div>
  </div></div>
}
