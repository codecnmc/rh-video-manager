import { Disclosure } from '@/components/ui/disclosure'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClapperboard, faDownload, faLink, faTowerBroadcast, faVideo, faCircleNotch, faRotateRight, faPause, faPlay } from '@fortawesome/free-solid-svg-icons'
import type { PreviewKind, PreviewMedia, PreviewSnapshot } from '@contracts/preview'
import { Button } from '@/components/ui/button'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { recordConsumptionLabel, summarizeDraftConsumption } from '../draft-consumption'

const labels: Record<PreviewKind, string> = { sampling: '实时采样', draft: '低清预览', final: '最终成片' }

function capabilityLabel(preview: PreviewSnapshot, kind: PreviewKind): string {
  if (preview.capabilities.status === 'checking') return '正在读取线上工作流'
  if (preview.capabilities.status === 'failed') return '线上工作流预览能力未确认'
  if (!preview.capabilities[kind]) return kind === 'sampling' ? '未检测到采样预览节点' : `未识别${labels[kind]}节点`
  return `等待${labels[kind]}`
}

function useMediaSource(media: PreviewMedia | null): string | undefined {
  const [resolved, setResolved] = useState<{ media: PreviewMedia; source: string }>()
  useEffect(() => {
    if (!media) { setResolved(undefined); return }
    if (!media.source.startsWith('data:')) { setResolved({ media, source: media.source }); return }
    const encoded = media.source.slice(media.source.indexOf(',') + 1)
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: media.mime }))
    setResolved({ media, source: url })
    return () => URL.revokeObjectURL(url)
  }, [media])
  return resolved?.media === media ? resolved.source : undefined
}

function MediaView({ media, kind, onDuration }: { media: PreviewMedia; kind: PreviewKind; onDuration: (seconds: number) => void }) {
  const source = useMediaSource(media)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [source])
  if (failed) return <div className="media-empty"><FontAwesomeIcon icon={faVideo} /><span>媒体无法播放，地址可能已过期</span></div>
  return media.mime === 'video/mp4'
    ? <video src={source} controls autoPlay={kind === 'sampling'} muted={kind === 'sampling'} loop={kind === 'sampling'} playsInline preload="metadata"
        onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) onDuration(event.currentTarget.duration) }} onError={() => setFailed(true)} />
    : <img src={source} alt={labels[kind]} onError={() => setFailed(true)} />
}

interface PreviewPanelProps {
  preview: PreviewSnapshot | undefined
  predecessor?: PreviewSnapshot | undefined
  records: PreviewSnapshot[]
  onSelectRecord: (id: string | null) => void
  selectedRecord: string | null
  title: string
  onNotice: (message: string) => void
}

function PreviewSlot({ preview, kind, onNotice }: Pick<PreviewPanelProps, 'preview' | 'onNotice'> & { kind: PreviewKind }) {
  const remoteMedia = preview?.[kind] ?? null
  const archive = kind === 'final' && preview?.finalArchive?.source === remoteMedia?.source ? preview?.finalArchive : undefined
  const localAssetId = archive?.status === 'ready' ? archive.assetId : undefined
  const media = useMemo(() => remoteMedia && localAssetId ? { ...remoteMedia, source: `workbench-asset://library/${localAssetId}` } : remoteMedia, [remoteMedia, localAssetId])
  const [downloading, setDownloading] = useState(false)
  const [duration, setDuration] = useState<{ source: string; seconds: number } | null>(null)
  const seconds = media && duration?.source === media.source ? duration.seconds : null
  const hasConsumption = preview?.consumption?.coins != null && !preview.consumption.conflictingFields.includes('coins') && /^\d{8,30}$/.test(preview.taskId)
  async function download() {
    if (!preview) return
    setDownloading(true)
    try { if (unwrap(await desktop().downloadPreview(preview.id, kind))) onNotice('媒体已保存') }
    catch (error) { onNotice(error instanceof Error ? error.message : '下载失败') }
    finally { setDownloading(false) }
  }
  return <section className={`preview-slot preview-slot-${kind}`} aria-label={labels[kind]}>
    <div className="early-heading"><span><FontAwesomeIcon icon={kind === 'sampling' ? faTowerBroadcast : kind === 'draft' ? faVideo : faClapperboard} /> {labels[kind]}</span>
      <span className={media ? 'text-success' : 'muted'}>{localAssetId ? '已存入素材库 · 本地播放' : archive?.status === 'downloading' ? '正在存入素材库' : media ? '可播放' : '等待中'}</span></div>
    <div className="main-media">
      {media ? <MediaView media={media} kind={kind} onDuration={(value) => setDuration({ source: media.source, seconds: value })} /> : <div className="media-empty"><FontAwesomeIcon icon={kind === 'sampling' ? faTowerBroadcast : faClapperboard} />
        <strong>{preview ? capabilityLabel(preview, kind) : '尚无生成结果'}</strong></div>}
    </div>
    <div className="media-footer"><span className="muted">{media ? new Date(media.receivedAt).toLocaleTimeString('zh-CN') : '无可播放媒体'}
      {seconds !== null && ` · ${kind === 'sampling' ? '采样片段' : '实际'} ${seconds.toFixed(1)}秒`}
      {kind !== 'sampling' && preview?.requestedDuration !== undefined && ` · 目标 ${preview.requestedDuration}秒`}
      {kind === 'final' && hasConsumption && preview && <span className="preview-record-consumption"> · 本次 {recordConsumptionLabel(preview)}</span>}
      {kind === 'sampling' && preview?.samplingTotal ? ` · ${preview.samplingStep} / ${preview.samplingTotal}步` : ''}</span>
      <div className="button-row">
        <Button variant="ghost" size="icon" title={`复制${labels[kind]} URL`} aria-label={`复制${labels[kind]} URL`} disabled={!remoteMedia || !remoteMedia.source.startsWith('https:')}
          onClick={() => { if (preview) void desktop().copyPreviewUrl(preview.id, kind).then((result) => { unwrap(result); onNotice('媒体 URL 已复制') }).catch(() => onNotice('复制失败')) }}><FontAwesomeIcon icon={faLink} /></Button>
        <Button variant="ghost" size="icon" title={`下载${labels[kind]}`} aria-label={`下载${labels[kind]}`} disabled={!media || downloading} onClick={() => void download()}>
          <FontAwesomeIcon icon={downloading ? faCircleNotch : faDownload} spin={downloading} /></Button>
      </div>
    </div>
    {archive?.status === 'failed' && <div className="inline-warning">{archive.error}<Button variant="ghost" size="icon" title="重试保存成片到素材库" aria-label="重试保存成片到素材库" onClick={() => {
      if (preview) void desktop().retryFinalArchive(preview.id).then((result) => unwrap(result)).catch(() => onNotice('归档重试未启动，请刷新后再试'))
    }}><FontAwesomeIcon icon={faRotateRight} /></Button></div>}
    {kind === 'final' && preview?.continuityReference && <div className={`preview-continuity-status ${preview.continuityReference.status === 'failed' ? 'inline-warning' : 'muted'}`}>
      {preview.continuityReference.status === 'ready' ? '尾段视频与最后帧已存入连续镜头参考' : preview.continuityReference.status === 'processing' ? '正在准备尾段视频与最后帧' : preview.continuityReference.error}
      {preview.continuityReference.status === 'failed' && <Button variant="ghost" size="icon" title="配置引擎或重试衔接素材" aria-label="配置引擎或重试衔接素材" onClick={() => {
        void desktop().retryFinalArchive(preview.id).then((result) => unwrap(result)).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '衔接素材重试未启动'))
      }}><FontAwesomeIcon icon={faRotateRight} /></Button>}
    </div>}
    {kind !== 'sampling' && seconds !== null && preview?.requestedDuration !== undefined && Math.abs(seconds - preview.requestedDuration) > 0.5 &&
      <p className="inline-warning">输出时长与提交目标不一致，请核对平台结果；不会自动重新生成。</p>}
  </section>
}

export function PreviewPanel({ preview, predecessor, title, onNotice, records, selectedRecord, onSelectRecord }: PreviewPanelProps) {
  const [outputPending, setOutputPending] = useState(false)
  const consumption = summarizeDraftConsumption(records)
  const outputs = (preview?.resultVideos ?? []).map((output, index) => ({ output, index }))
    .filter(({ output }) => output.source !== preview?.draft?.source && output.source !== preview?.final?.source)
  async function outputAction(index: number, action: 'copy' | 'download') {
    if (!preview) return
    setOutputPending(true)
    try {
      if (unwrap(await desktop().taskOutputAction(preview.id, index, action))) onNotice(action === 'copy' ? '媒体 URL 已复制' : '媒体已保存')
    } catch (error) { onNotice(error instanceof Error ? error.message : '操作失败') }
    finally { setOutputPending(false) }
  }
  return <section className="review-pane">
    <div className="pane-toolbar preview-toolbar"><h2>{title}</h2>
      {consumption.knownCoins !== null
        ? <div className="draft-consumption" title={`草稿历史生成的已知耗币合计，共 ${consumption.knownCount} 笔`}><span className="muted">累计</span> <strong>{consumption.knownCoins}</strong> <span className="muted">RH 币</span></div>
        : <span className="muted">{preview ? '远端任务' : '视频预览'}</span>}
    </div>
    <div className="generation-records"><label htmlFor="generation-record">生成记录（{records.length}）</label>
      <SelectField id="generation-record" value={selectedRecord && records.some((item) => item.id === selectedRecord) ? selectedRecord : 'latest'} disabled={!records.length} onChange={(event) => onSelectRecord(event.target.value === 'latest' ? null : event.target.value)}>
        <SelectOption value="latest">最新记录{records[0] ? ` · ${records[0].stage}` : ' · 暂无'}</SelectOption>
        {records.map((record, index) => <SelectOption key={record.id} value={record.id}>{`第 ${records.length - index} 次 · ${record.submittedAt ? new Date(record.submittedAt).toLocaleString('zh-CN') : record.taskId || record.id} · ${record.stage}`}</SelectOption>)}
      </SelectField>
    </div>
    <PreviewSlot key={`${preview?.id}-final`} preview={preview} kind="final" onNotice={onNotice} />
    <ContinuityPreview key={`${preview?.id}-${predecessor?.id}`} predecessor={predecessor} sampling={preview?.sampling ?? null} onNotice={onNotice} />
    <div className="early-previews">
      {(['sampling', 'draft'] as const).map((value) => <PreviewSlot key={`${preview?.id}-${value}`} preview={preview} kind={value} onNotice={onNotice} />)}
    </div>
    {preview?.notice && <p className="inline-warning">{preview.notice}</p>}
    {outputs.length > 0 && <Disclosure className="platform-outputs" open>
      <summary>平台视频输出（未分类 {outputs.length}）</summary>
      {outputs.map(({ output, index }) => <div className="platform-output" key={output.source}>
        <video src={output.source} controls playsInline preload="metadata" />
        <div className="media-footer"><span className="muted">视频输出 {index + 1}</span><div className="button-row">
          <Button variant="ghost" size="icon" title="复制输出 URL" aria-label="复制输出 URL" disabled={outputPending} onClick={() => void outputAction(index, 'copy')}><FontAwesomeIcon icon={faLink} /></Button>
          <Button variant="ghost" size="icon" title="下载视频输出" aria-label="下载视频输出" disabled={outputPending} onClick={() => void outputAction(index, 'download')}><FontAwesomeIcon icon={faDownload} /></Button>
        </div></div>
      </div>)}
    </Disclosure>}
    {preview?.capabilities.status === 'ready' && preview.capabilities.unclassifiedOutputs > 0 && <p className="inline-warning">存在未分类视频输出，低清与成片角色待确认。</p>}
  </section>
}

function ContinuityPreview({ predecessor, sampling, onNotice }: { predecessor: PreviewSnapshot | undefined; sampling: PreviewMedia | null; onNotice: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false)
  const [phase, setPhase] = useState(0)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<PreviewMedia | null>(sampling)
  const [switching, setSwitching] = useState(false)
  const previousVideo = useRef<HTMLVideoElement>(null)
  const currentVideo = useRef<HTMLVideoElement>(null)
  const latest = useRef(sampling)
  latest.current = sampling
  const previous = useMemo(() => {
    if (predecessor?.sampling?.mime === 'video/mp4') return predecessor.sampling
    if (predecessor?.finalArchive?.status === 'ready' && predecessor.finalArchive.assetId && predecessor.finalArchive.source === predecessor.final?.source) {
      return { ...predecessor.final!, source: `workbench-asset://library/${predecessor.finalArchive.assetId}` }
    }
    return predecessor?.final?.mime === 'video/mp4' ? predecessor.final : null
  }, [predecessor])
  const previousSource = useMediaSource(previous)
  const currentSource = useMediaSource(current)
  const available = Boolean(previous && sampling?.mime === 'video/mp4')
  function showCurrent() {
    if (!switching || !currentSource || !currentVideo.current || currentVideo.current.seeking || currentVideo.current.readyState < 2) return
    setSwitching(false); setPhase(1)
  }
  useEffect(() => { showCurrent() }, [switching, currentSource])
  useEffect(() => {
    if (!enabled || !running) { previousVideo.current?.pause(); currentVideo.current?.pause(); return }
    const element = phase === 0 ? previousVideo.current : currentVideo.current
    const source = phase === 0 ? previousSource : currentSource
    if (!element || !source) return
    const inactive = phase === 0 ? currentVideo.current : previousVideo.current
    inactive?.pause()
    let cancelled = false
    void element.play().catch(() => { if (!cancelled) { setRunning(false); onNotice('连续预览无法播放，请检查前序与采样媒体') } })
    return () => { cancelled = true }
  }, [enabled, running, phase, previousSource, currentSource])
  return <section className="preview-slot" aria-label="连续预览">
    <div className="early-heading"><label><input type="checkbox" checked={enabled} disabled={!available} onChange={(event) => {
      setEnabled(event.target.checked); setPhase(0); setSwitching(false); setCurrent(latest.current); setRunning(event.target.checked)
      if (previousVideo.current) previousVideo.current.currentTime = 0
    }} /> 连续预览</label><span className="muted">{!predecessor ? '未匹配到真实前序任务' : !available ? '等待可播放采样' : phase === 0 ? '上一段' : '当前采样'}</span></div>
    {enabled && <><div className="main-media" style={{ position: 'relative' }}>
      <video ref={previousVideo} src={previousSource} muted playsInline preload="auto" style={{ visibility: phase === 0 ? 'visible' : 'hidden' }} onEnded={() => {
        // 当前轮播放期间不替换采样 src，避免新采样到达时突然跳帧或重新播放。
        setCurrent(latest.current); setSwitching(true)
        if (currentVideo.current) currentVideo.current.currentTime = 0
      }} onError={() => { setRunning(false); onNotice('连续预览的前序视频不可用') }} />
      <video ref={currentVideo} src={currentSource} muted playsInline preload="auto" onSeeked={showCurrent} onLoadedData={showCurrent} onCanPlay={showCurrent} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', visibility: phase === 1 ? 'visible' : 'hidden' }} onEnded={() => {
        setPhase(0); if (previousVideo.current) previousVideo.current.currentTime = 0
      }} onError={() => { setRunning(false); onNotice('连续预览的采样视频不可用') }} />
    </div><div className="media-footer"><span className="muted">{current ? `采样 ${new Date(current.receivedAt).toLocaleTimeString('zh-CN')} · 静音预览` : '等待采样'}</span><Button variant="ghost" size="icon" title={running ? '暂停连续预览' : '播放连续预览'} aria-label={running ? '暂停连续预览' : '播放连续预览'} onClick={() => setRunning(!running)}><FontAwesomeIcon icon={running ? faPause : faPlay} /></Button></div></>}
  </section>
}
