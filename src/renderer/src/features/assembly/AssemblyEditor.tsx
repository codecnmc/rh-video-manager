import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faArrowRight, faChevronLeft, faChevronRight, faCopy, faFloppyDisk, faPen, faPlug,
  faRotateLeft, faRotateRight, faTrash, faMagnifyingGlass, faFileExport, faStop, faSpinner, faCheck, faScissors, faMagnet, faLinkSlash, faCompress, faArrowUpRightFromSquare, faHeading } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyContent, AssemblyDocument, AssemblyVersion } from '@contracts/assembly'
import { assemblyContentSchema } from '@contracts/assembly'
import type { Asset } from '@contracts/assets'
import type { AssetMcpStatus } from '@contracts/mcp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Dialog } from '@/components/ui/dialog'
import { confirmAction } from '@/components/ui/confirmation'
import { AssemblyTimelinePlayer } from './AssemblyTimelinePlayer'
import { AssemblySounds } from './AssemblySounds'
import { ClipColorControls } from './ClipColorControls'
import { useAssemblyEditor } from './use-assembly-editor'
import { pendingSounds, timecode, totalDuration, timelineClips, reorderClips, splitClip, splitSound, removeClip as deleteClip, clearInvalidTransitions, rollingTrim } from './assembly-state'
import { useAssemblyExport } from './use-assembly-export'
import { AssemblySources, AssemblySourcePreview, assemblyAssetDragType } from './AssemblySources'
import { AssemblyTimeline } from './AssemblyTimeline'
import { AssemblyTracks } from './AssemblyTracks'
import { AssemblySubtitles } from './AssemblySubtitles'
import { assemblyShortcut } from './assembly-shortcuts'
import { AssemblyInsertTitle, AssemblyTitleInspector } from './AssemblyTitleControls'
import { AssemblyCanvasControls } from './AssemblyCanvasControls'
import { insertTimelineClip, removeGeneratedClip } from '../../../../shared/assembly-insert'
import { AssemblyPlaybackScope } from './AssemblyPlaybackScope'
import { assemblyTransitions } from '../../../../shared/assembly-transitions'
import { assemblyTransitionKindSchema } from '../../../../shared/contracts/assembly-effects'
import { AssemblyMaskControls } from './AssemblyMaskControls'
import { defaultAssemblyExportOptions } from '@contracts/assembly-export'
import { AssemblyExportSettings, AssemblyExportProgressView } from './AssemblyExportControls'

interface EditorProps {
  active?: boolean; onOpenWindow?: ((document: AssemblyDocument) => Promise<void>) | undefined
  registerWindowOpener?: (action: (() => Promise<void>) | null) => void
  document: AssemblyDocument; documents: AssemblyDocument[]; assets: Asset[]; assetsLoading: boolean; assetsError?: string | undefined
  mcpStatus?: AssetMcpStatus | undefined
  saving: boolean; importing: boolean; onReloadAssets: () => void; onImport: (kind: 'video' | 'audio') => Promise<Asset[]>
  onSave: (content: AssemblyContent, revision: number) => Promise<AssemblyDocument>
  onBack: () => void; onOpen: (document: AssemblyDocument) => void; onDirty: (dirty: boolean) => void; onNotice: (message: string) => void
}

const detailsSchema = z.object({
  name: z.string().trim().min(1, '请填写名称').max(150, '名称过长'),
  episode: z.string().regex(/^$|^[1-9]\d{0,5}$/, '集数应为 1 至 999999，或留空')
})
type DetailsValues = z.infer<typeof detailsSchema>

export function AssemblyEditor(props: EditorProps) {
  const editor = useAssemblyEditor(props.document, props.onDirty, props.onSave, props.onNotice)
  const { content, version, clip } = editor
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [episodeSearch, setEpisodeSearch] = useState('')
  const [inspector, setInspector] = useState<'clip' | 'sounds' | 'tracks' | 'subtitles' | 'canvas'>('clip')
  const [insertingTitle, setInsertingTitle] = useState(false)
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState(defaultAssemblyExportOptions)
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(true)
  const [rollDelta, setRollDelta] = useState(0)
  const [soundSelection, setSoundSelection] = useState<{ versionId: string; id: string } | null>(null)
  const [dialog, setDialog] = useState<'metadata' | 'version' | null>(null)
  const details = useForm<DetailsValues>({ resolver: zodResolver(detailsSchema), defaultValues: { name: '', episode: '' } })
  const [dialogError, setDialogError] = useState('')
  const [zoom, setZoom] = useState(36)
  const [position, setPosition] = useState(0)
  const [openingWindow, setOpeningWindow] = useState(false)
  const [seekRequest, setSeekRequest] = useState({ time: 0, serial: 0 })
  useEffect(() => {
    // 弹窗经 Portal 挂在页面外，隐藏编辑页时需单独关闭，不能遮住视频生成页。
    if (props.active === false) { setSwitching(false); setDialog(null); setInsertingTitle(false); setExportSettingsOpen(false) }
  }, [props.active])
  const baseLocked = props.saving || props.importing || editor.reading || openingWindow
  const index = version.clips.findIndex((item) => item.id === clip?.id)
  const ordered = [...props.documents].sort((a, b) => (a.episode ?? Infinity) - (b.episode ?? Infinity) || a.title.localeCompare(b.title, 'zh-CN', { numeric: true }))
  const numbered = ordered.filter((item) => item.episode !== null)
  const previousEpisode = props.document.episode === null ? undefined : numbered.filter((item) => item.episode! < props.document.episode!).at(-1)
  const nextEpisode = props.document.episode === null ? undefined : numbered.find((item) => item.episode! > props.document.episode!)
  const source = props.assets.find((asset) => asset.id === sourceId)
  const usedAssets = new Set([...version.clips.flatMap((item) => item.assetId ? [item.assetId] : []), ...version.sounds.flatMap((item) => item.assetId ? [item.assetId] : [])])
  const pending = pendingSounds(version)
  const latest = props.documents.find((item) => item.id === props.document.id)
  const externalChanges = latest !== undefined && latest.revision > props.document.revision
  const mcp = props.mcpStatus
  const mcpAuthorized = mcp?.enabled && mcp.assemblyEnabled && (mcp.allProjects || mcp.projectId === props.document.projectId)
  const mcpLabel = !mcp ? 'MCP 状态未读取' : !mcp.enabled ? 'MCP 未开启' : !mcp.assemblyEnabled ? 'MCP 未授权排片' : !mcpAuthorized ? 'MCP 项目未授权' : mcp.writeEnabled ? 'MCP 可读写' : 'MCP 只读'
  const { exporting, exportVideo, cancel: cancelExport, progress: exportProgress, cancelling, dismissProgress } = useAssemblyExport({ document: props.document, content, dirty: editor.dirty,
    disabled: baseLocked, externalChanges, save: editor.save, onNotice: props.onNotice })
  const locked = baseLocked || exporting
  const selectedSound = soundSelection?.versionId === version.id && version.sounds.some((sound) => sound.id === soundSelection.id) ? soundSelection.id : null
  function seek(time: number) { setSourceId(null); setSeekRequest((value) => ({ time, serial: value.serial + 1 })) }
  function addSource(asset: Asset) {
    if (locked || asset.kind !== 'video' && asset.kind !== 'audio') return
    setSourceId(null)
    void editor.addVideo(asset, position)
  }
  async function navigate(action: () => void) {
    if (locked) return
    if (editor.dirty && !await confirmAction('当前排片尚未保存，放弃修改并切换？')) return
    props.onDirty(false); action()
  }
  async function importMedia(kind: 'video' | 'audio') {
    try { const imported = await props.onImport(kind); if (imported.length) props.onNotice(`已导入 ${imported.length} 项到本地素材库`) }
    catch (error) { props.onNotice(error instanceof Error ? error.message : '导入失败') }
  }
  function save() {
    const parsed = assemblyContentSchema.safeParse(content)
    if (!parsed.success) { props.onNotice('请检查片段范围、转场余量、音轨和字幕设置后再保存'); return }
    void editor.save()
  }
  async function detach() {
    if (!props.onOpenWindow) return
    if (locked) { props.onNotice('剪辑正在读取、保存或导出，请稍候再打开独立窗口'); return }
    if (externalChanges) { props.onNotice('请先载入最新修订，再打开独立窗口'); return }
    if (!assemblyContentSchema.safeParse(content).success) { props.onNotice('请先修正剪辑内容后再打开独立窗口'); return }
    if (editor.dirty && !await confirmAction('保存当前修改，并在独立窗口继续剪辑？主窗口将锁定此项目的剪辑。')) return
    setOpeningWindow(true)
    try {
      const saved = editor.dirty ? await editor.save() : props.document
      if (saved) await props.onOpenWindow(saved)
    } catch (error) { props.onNotice(error instanceof Error ? error.message : '打开独立剪辑窗口失败') }
    finally { setOpeningWindow(false) }
  }
  useEffect(() => {
    // 父级菜单复用当前编辑器的实时校验和保存确认，不读取过期工程快照。
    props.registerWindowOpener?.(detach)
    return () => props.registerWindowOpener?.(null)
  })
  function openDialog(mode: 'metadata' | 'version') {
    setDialog(mode); details.reset({ name: mode === 'metadata' ? content.title : `${version.name} 副本`, episode: String(content.episode ?? '') }); setDialogError('')
  }
  function commitDialog({ name, episode }: DetailsValues) {
    if (!name.trim() || name.trim().length > (dialog === 'version' ? 80 : 150)) { setDialogError('请填写有效名称'); return }
    if (dialog === 'metadata') {
      if (!/^$|^[1-9]\d{0,5}$/.test(episode)) { setDialogError('集数应为 1 至 999999，或留空'); return }
      editor.change({ ...content, title: name.trim(), episode: episode ? Number(episode) : null })
    } else {
      if (content.versions.length >= 100) { setDialogError('每个工程最多保存 100 个剪辑版本'); return }
      const copy: AssemblyVersion = { ...structuredClone(version), id: crypto.randomUUID(), name: name.trim() }
      editor.change({ ...content, activeVersionId: copy.id, versions: [...content.versions, copy] })
    }
    setDialog(null)
  }
  function removeClip(ripple: boolean) {
    if (!clip) return
    try {
      editor.updateVersion(clip.visual && ripple ? removeGeneratedClip(version, clip.id, crypto.randomUUID) : deleteClip(version, clip.id, ripple))
      editor.setSelected(null)
    } catch (error) { props.onNotice(error instanceof Error ? error.message : '片段删除失败') }
  }
  function detachAudio() {
    if (!clip?.originalAudio || !clip.assetId) return
    const track = { id: crypto.randomUUID(), name: `原声 · ${clip.title}`, kind: 'voice' as const, muted: false, solo: false, locked: false, gain: 1 }
    editor.updateVersion({ ...version, tracks: [...(version.tracks ?? []), track], clips: version.clips.map((item) => item.id === clip.id ? { ...item, originalAudio: false } : item),
      sounds: [...version.sounds, { id: crypto.randomUUID(), clipId: null, trackId: track.id, kind: 'voice', title: clip.title, evidence: '', state: 'bound', assetId: clip.assetId,
        sourceKind: 'video', sourceIn: clip.inPoint, sourceDuration: clip.sourceDuration, start: timelineClips(version).find((item) => item.clip.id === clip.id)?.start ?? 0,
        duration: clip.outPoint - clip.inPoint, gain: 1 }] })
  }
  function splitSelection() {
    const next = inspector === 'sounds' && selectedSound ? splitSound(version, selectedSound, position, crypto.randomUUID()) : inspector === 'clip' && clip ? splitClip(version, clip.id, position, crypto.randomUUID()) : version
    if (next === version) props.onNotice('请选中片段或声音，并将播放头放在其内部')
    else editor.updateVersion(next)
  }
  function deleteSelection() {
    if (inspector === 'clip' && clip) removeClip(false)
    else if (inspector === 'subtitles' && selectedCaption) editor.updateVersion({ ...version, captions: (version.captions ?? []).filter((item) => item.id !== selectedCaption) })
    else if (inspector === 'sounds' && selectedSound) {
      const sound = version.sounds.find((item) => item.id === selectedSound)
      if (version.tracks?.some((track) => track.id === sound?.trackId && track.locked)) { props.onNotice('轨道已锁定'); return }
      editor.updateVersion({ ...version, sounds: version.sounds.filter((item) => item.id !== selectedSound) })
    }
  }
  return <AssemblyPlaybackScope active={props.active ?? true}><section className="assembly-editor" aria-label="排片编辑器" tabIndex={-1} onPointerDownCapture={(event) => {
    if (!(event.target as HTMLElement).closest('button, input, textarea, select, a, [role="combobox"], [contenteditable="true"]')) event.currentTarget.focus({ preventScroll: true })
  }} onKeyDown={(event) => {
    // 表单保留原生撤销、删除；弹窗和菜单不触发时间轴命令。
    if (locked || dialog || switching || insertingTitle || exportSettingsOpen || event.defaultPrevented || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="menu"]')) return
    const action = assemblyShortcut({ ...event, isComposing: event.nativeEvent.isComposing })
    if (!action) return
    if (action === 'play' && (event.target as HTMLElement).closest('button:not([data-assembly-command="play"])')) return
    event.preventDefault(); event.stopPropagation()
    if (action === 'undo') editor.undo()
    else if (action === 'redo') editor.redo()
    else if (action === 'save') save()
    else if (action === 'split') splitSelection()
    else if (action === 'delete') deleteSelection()
    else event.currentTarget.querySelector<HTMLButtonElement>(`[data-assembly-command="${action}"]`)?.click()
  }}>
    <header className="assembly-editor-heading"><Button variant="ghost" size="icon" title="返回工程列表" aria-label="返回工程列表" disabled={locked} onClick={() => void navigate(props.onBack)}><FontAwesomeIcon icon={faArrowLeft} /></Button>
      <div className="assembly-editor-title"><h1 title={content.title}>{content.title}</h1><span className="muted" role="status">{props.saving ? '正在保存' : editor.dirty ? '有未保存修改' : `已保存 · 修订 ${props.document.revision}`}</span></div>
      <Button variant="ghost" size="icon" title="修改工程名称与集数" aria-label="修改工程名称与集数" disabled={locked} onClick={() => openDialog('metadata')}><FontAwesomeIcon icon={faPen} /></Button>
      <div className="assembly-switchbar" aria-label="工程与版本"><Button variant="ghost" size="icon" title="上一集" aria-label="上一集" disabled={locked || !previousEpisode} onClick={() => previousEpisode && void navigate(() => props.onOpen(previousEpisode))}><FontAwesomeIcon icon={faChevronLeft} /></Button>
        <Button variant="outline" disabled={locked} onClick={() => { setEpisodeSearch(''); setSwitching(true) }}>{content.episode === null ? '未分集' : `第 ${String(content.episode).padStart(3, '0')} 集`} · 切换工程</Button>
        <Button variant="ghost" size="icon" title="下一集" aria-label="下一集" disabled={locked || !nextEpisode} onClick={() => nextEpisode && void navigate(() => props.onOpen(nextEpisode))}><FontAwesomeIcon icon={faChevronRight} /></Button>
        <label>版本<SelectField aria-label="剪辑版本" disabled={locked} value={version.id} onChange={(event) => { editor.change({ ...content, activeVersionId: event.target.value }); editor.setSelected(null) }}>{content.versions.map((item) => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}</SelectField></label>
        <Button variant="ghost" size="icon" title="另存剪辑版本" aria-label="另存剪辑版本" disabled={locked} onClick={() => openDialog('version')}><FontAwesomeIcon icon={faCopy} /></Button></div>
      <div className="button-row"><span className={`assembly-capability ${mcpAuthorized ? 'text-success' : ''}`} title="排片工具使用 MCP 页的独立授权，手动编辑不受此开关限制"><FontAwesomeIcon icon={faPlug} />{mcpLabel}</span>
        {props.onOpenWindow && <Button variant="ghost" size="icon" title="在独立窗口剪辑" aria-label="在独立窗口剪辑" disabled={locked} onClick={() => void detach()}><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></Button>}
        {exporting && <Button variant="ghost" size="icon" title="取消导出" aria-label="取消导出" onClick={cancelExport}><FontAwesomeIcon icon={faStop} /></Button>}
        <Button variant="outline" disabled={locked || !version.clips.length} title={!version.clips.length ? '请先添加视频片段' : '设置参数并导出当前版本为 MP4'} onClick={() => setExportSettingsOpen(true)}><FontAwesomeIcon icon={exporting ? faSpinner : faFileExport} spin={exporting} />{exporting ? '正在导出' : '导出'}</Button>
        <Button disabled={locked} title={editor.dirty ? '保存工程修改' : '当前工程已是最新保存状态'} onClick={save}><FontAwesomeIcon icon={editor.dirty ? faFloppyDisk : faCheck} />{props.saving ? '正在保存' : editor.dirty ? '保存' : '已保存'}</Button></div></header>
    {exportProgress && <AssemblyExportProgressView progress={exportProgress} exporting={exporting} cancelling={cancelling} onCancel={cancelExport} onDismiss={dismissProgress} />}
    {externalChanges && latest && <div className="assembly-external-change" role="status"><span>已有外部新修订，本地修改未覆盖</span><Button variant="outline" disabled={locked} onClick={() => void navigate(() => props.onOpen(latest))}><FontAwesomeIcon icon={faRotateRight} />载入最新版本</Button></div>}
    <div className="assembly-editing-area">
      <AssemblySources assets={props.assets} loading={props.assetsLoading} error={props.assetsError} disabled={locked} importing={props.importing}
        selected={source?.id} used={usedAssets} onSelect={(asset) => setSourceId(asset.id)} onAdd={addSource} onReload={props.onReloadAssets} onImport={(kind) => void importMedia(kind)} />
      {source ? <AssemblySourcePreview key={`${source.id}-${source.updatedAt}`} asset={source} active={props.active ?? true} onClose={() => setSourceId(null)} /> : <AssemblyTimelinePlayer active={props.active ?? true} version={version} seekRequest={seekRequest} onPosition={setPosition} onNotice={props.onNotice} />}
      <aside className="assembly-inspector"><div className="assembly-tabs" role="tablist" aria-label="检查器">{(['clip', 'sounds', 'tracks', 'subtitles', 'canvas'] as const).map((tab) => <Button key={tab} variant="unstyled" role="tab" aria-selected={inspector === tab} onClick={() => setInspector(tab)}>{{ clip: '片段', sounds: `声音${pending ? ` (${pending})` : ''}`, tracks: '轨道', subtitles: '字幕', canvas: '画布' }[tab]}</Button>)}</div>
        <div className="assembly-inspector-body">{inspector === 'canvas' ? <AssemblyCanvasControls version={version} disabled={locked} onChange={editor.updateVersion} /> : inspector === 'subtitles' ? <AssemblySubtitles key={version.id} version={version} position={position} disabled={locked} selected={selectedCaption} onSelect={setSelectedCaption} onChange={editor.updateVersion} onSeek={seek} onNotice={props.onNotice} /> : inspector === 'tracks' ? <AssemblyTracks version={version} disabled={locked} onChange={editor.updateVersion} /> : inspector === 'sounds' ? <AssemblySounds version={version} assets={props.assets} selectedClip={clip?.id} selectedSound={selectedSound} onChange={editor.updateVersion} disabled={locked} /> : clip ? <fieldset className="assembly-form" disabled={locked}>
          <label>片段名称<Input maxLength={200} value={clip.title} onChange={(event) => editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, title: event.target.value } : item) })} /></label>
          {clip.visual && <AssemblyTitleInspector key={`${clip.id}-${clip.outPoint - clip.inPoint}`} version={version} clip={clip} onChange={editor.updateVersion} onNotice={props.onNotice} />}
          <AssemblyMaskControls inherited mask={clip.frameMask} onChange={(frameMask) => editor.updateVersion({ ...version, clips: version.clips.map((item) => {
            if (item.id !== clip.id) return item
            const next = { ...item }; if (frameMask === undefined) delete next.frameMask; else next.frameMask = frameMask
            return next
          }) })} />
          {!clip.visual && <>
          <div className="assembly-field-pair"><label>入点 / 秒<Input type="number" min={0} max={clip.outPoint} step={0.01} value={clip.inPoint} onChange={(event) => { const next = Number(event.target.value); if (next >= 0 && next < clip.outPoint) editor.updateVersion(clearInvalidTransitions({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, inPoint: next } : item) })) }} /></label>
            <label>出点 / 秒<Input type="number" min={clip.inPoint} max={clip.sourceDuration} step={0.01} value={clip.outPoint} onChange={(event) => { const next = Number(event.target.value); if (next > clip.inPoint && next <= clip.sourceDuration) editor.updateVersion(clearInvalidTransitions({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, outPoint: next } : item) })) }} /></label></div>
          </>}
          <label>成片起点 / 秒<Input type="number" min={0} step={0.01} value={timelineClips(version)[index]?.start ?? 0} onChange={(event) => {
            const previousEnd = timelineClips(version)[index - 1]?.end ?? 0
            const next = event.target.valueAsNumber
            if (next >= previousEnd && next <= 86400) editor.updateVersion(clearInvalidTransitions({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, gapBefore: next - previousEnd, transition: undefined } : item) }))
          }} /></label>
          <label>与上一片段的转场<SelectField id="assembly-transition-kind" value={clip.transition?.kind ?? 'cut'} disabled={index === 0 || (clip.gapBefore ?? 0) > 0} onChange={(event) => {
            const kind = event.target.value
            const parsedKind = assemblyTransitionKindSchema.safeParse(kind)
            const transition: AssemblyVersion['clips'][number]['transition'] = parsedKind.success ? { kind: parsedKind.data, duration: 0.5 } : undefined
            const next = { ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, transition } : item) }
            if (assemblyContentSchema.safeParse({ ...content, versions: content.versions.map((item) => item.id === version.id ? next : item) }).success) editor.updateVersion(next)
            else props.onNotice('相邻片段余量不足，无法应用转场')
          }}><SelectOption value="cut">硬切</SelectOption>{Object.entries(assemblyTransitions).map(([kind, definition]) => <SelectOption key={kind} value={kind}>{definition.label}</SelectOption>)}</SelectField></label>
          {clip.transition && <label>转场时长 / 秒<Input type="number" min={0.01} max={10} step={0.01} value={clip.transition.duration} onChange={(event) => {
            if (!clip.transition) return
            const next = { ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, transition: { ...clip.transition!, duration: event.target.valueAsNumber } } : item) }
            if (assemblyContentSchema.safeParse({ ...content, versions: content.versions.map((item) => item.id === version.id ? next : item) }).success) editor.updateVersion(next)
            else props.onNotice('转场时长超出相邻片段可用范围')
          }} /></label>}
          <div className="assembly-field-pair"><label>画面淡入 / 秒<Input type="number" min={0} step={0.01} disabled={clip.transition?.kind === 'dissolve'} value={clip.fadeIn ?? 0} onChange={(event) => { const fadeIn = event.target.valueAsNumber; if (fadeIn >= 0 && fadeIn + (clip.fadeOut ?? 0) <= clip.outPoint - clip.inPoint) editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, fadeIn } : item) }) }} /></label>
            <label>画面淡出 / 秒<Input type="number" min={0} step={0.01} disabled={version.clips[index + 1]?.transition?.kind === 'dissolve'} value={clip.fadeOut ?? 0} onChange={(event) => { const fadeOut = event.target.valueAsNumber; if (fadeOut >= 0 && fadeOut + (clip.fadeIn ?? 0) <= clip.outPoint - clip.inPoint) editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, fadeOut } : item) }) }} /></label></div>
          <div className="assembly-field-pair"><label>接点联动调整 / 秒<Input type="number" step={0.01} value={rollDelta} onChange={(event) => setRollDelta(event.target.valueAsNumber || 0)} /></label><Button variant="outline" disabled={!!clip.visual || !!version.clips[index + 1]?.visual || !version.clips[index + 1] || !!version.clips[index + 1]?.transition || (version.clips[index + 1]?.gapBefore ?? 0) > 0} onClick={() => { editor.updateVersion(rollingTrim(version, clip.id, rollDelta)); setRollDelta(0) }}>应用</Button></div>
          {!clip.visual && <><span className="muted">原片 {timecode(clip.sourceDuration)}</span><label className="assembly-checkbox"><input type="checkbox" checked={clip.originalAudio} onChange={(event) => editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, originalAudio: event.target.checked } : item) })} />保留原片声音</label>
          <Button variant="outline" disabled={!clip.originalAudio || (version.tracks?.length ?? 0) >= 128} onClick={detachAudio}><FontAwesomeIcon icon={faLinkSlash} />原声解链接</Button>
          <label>画面缩放<input type="range" min={1} max={3} step={0.01} value={clip.transform?.scale ?? 1} onChange={(event) => editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, transform: { x: 0, y: 0, ...item.transform, scale: Number(event.target.value) } } : item) })} /></label>
          <div className="assembly-field-pair">{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis === 'x' ? '水平取景' : '垂直取景'}<input type="range" min={-1} max={1} step={0.01} value={clip.transform?.[axis] ?? 0} onChange={(event) => editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, transform: { scale: 1, x: 0, y: 0, ...item.transform, [axis]: Number(event.target.value) } } : item) })} /></label>)}</div>
          <ClipColorControls color={clip.color} onChange={(color) => editor.updateVersion({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, color } : item) })} />
          <label>来源提示词<textarea readOnly rows={9} value={clip.prompt} placeholder="此素材未附带来源提示词" /></label></>}
        </fieldset> : <div className="assembly-subtle-empty">未选择视频片段</div>}</div>
      </aside>
    </div>
    <section className={`assembly-timeline-section${dropActive ? ' assembly-drop-active' : ''}`} aria-label="排片时间轴" onDragOver={(event) => {
      if (locked || !event.dataTransfer.types.includes(assemblyAssetDragType)) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true)
    }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false) }} onDrop={(event) => {
      setDropActive(false)
      if (locked || !event.dataTransfer.types.includes(assemblyAssetDragType)) return
      event.preventDefault()
      // 拖放仅接受当前授权素材快照中的视频 ID，不读取外部文件或拖入的任意地址。
      const asset = props.assets.find((item) => item.id === event.dataTransfer.getData(assemblyAssetDragType) && (item.kind === 'video' || item.kind === 'audio'))
      if (asset) addSource(asset)
    }}><div className="assembly-timeline-toolbar"><h2>{dropActive ? '松开添加到末尾' : '时间轴'}</h2>
      <Button variant="ghost" size="icon" title="在播放头插入字幕卡" aria-label="插入字幕卡" disabled={locked} onClick={() => setInsertingTitle(true)}><FontAwesomeIcon icon={faHeading} /></Button>
      <label>转场接点<SelectField aria-label="选择转场接点" disabled={locked || version.clips.length < 2} value="" onChange={(event) => {
        if (!event.target.value) return
        editor.setSelected(event.target.value); setInspector('clip'); setSourceId(null)
        requestAnimationFrame(() => window.document.getElementById('assembly-transition-kind')?.focus())
      }}><SelectOption value="">选择接点</SelectOption>{version.clips.slice(1).map((item, offset) => <SelectOption key={item.id} value={item.id} disabled={(item.gapBefore ?? 0) > 0}>{offset + 1} → {offset + 2} · {item.title}</SelectOption>)}</SelectField></label>
      <Button variant="ghost" size="small" title="撤销 (Ctrl+Z)" aria-label="撤销" aria-keyshortcuts="Control+Z Meta+Z" disabled={locked || !editor.canUndo} onClick={editor.undo}><FontAwesomeIcon icon={faRotateLeft} />撤销</Button><Button variant="ghost" size="small" title="重做 (Ctrl+Y / Ctrl+Shift+Z)" aria-label="重做" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z" disabled={locked || !editor.canRedo} onClick={editor.redo}><FontAwesomeIcon icon={faRotateRight} />重做</Button>
      <Button variant="ghost" size="icon" title="片段前移" aria-label="片段前移" disabled={locked || index <= 0} onClick={() => editor.move(-1)}><FontAwesomeIcon icon={faArrowLeft} /></Button><Button variant="ghost" size="icon" title="片段后移" aria-label="片段后移" disabled={locked || index < 0 || index >= version.clips.length - 1} onClick={() => editor.move(1)}><FontAwesomeIcon icon={faArrowRight} /></Button>
      <Button variant="ghost" size="icon" title="播放头处分割选中片段或声音 (Ctrl+B)" aria-label="分割片段" aria-keyshortcuts="Control+B Meta+B" disabled={locked || !clip && !selectedSound} onClick={splitSelection}><FontAwesomeIcon icon={faScissors} /></Button>
      <Button variant="ghost" size="icon" title="复制选中片段或声音" aria-label="复制片段" disabled={locked || !clip && !selectedSound} onClick={() => {
        const sound = inspector === 'sounds' ? version.sounds.find((item) => item.id === selectedSound) : undefined
        if (sound) {
          if (version.tracks?.some((track) => track.id === sound.trackId && track.locked)) { props.onNotice('轨道已锁定'); return }
          editor.updateVersion({ ...version, sounds: [...version.sounds, { ...sound, id: crypto.randomUUID(), start: sound.start + sound.duration }] })
        } else if (clip?.visual) {
          const entry = timelineClips(version).find((item) => item.clip.id === clip.id)!
          try { editor.updateVersion(insertTimelineClip(version, { ...clip, id: crypto.randomUUID(), gapBefore: 0, transition: undefined }, entry.end, crypto.randomUUID)) }
          catch (error) { props.onNotice(error instanceof Error ? error.message : '字幕卡复制失败') }
        } else if (clip) editor.updateVersion(clearInvalidTransitions({ ...version, clips: version.clips.flatMap((item) => item.id === clip.id ? [item, { ...item, id: crypto.randomUUID(), gapBefore: 0, transition: undefined }] : [item]) }))
      }}><FontAwesomeIcon icon={faCopy} /></Button>
      <Button variant="ghost" size="icon" title="删除画面并保留空隙" aria-label="删除片段" disabled={locked || !clip} onClick={() => removeClip(false)}><FontAwesomeIcon icon={faTrash} /></Button>
      <Button variant="ghost" size="icon" title="波纹删除画面" aria-label="波纹删除片段" disabled={locked || !clip} onClick={() => removeClip(true)}><FontAwesomeIcon icon={faCompress} /></Button>
      <Button variant="ghost" size="icon" title="时间轴吸附" aria-label="时间轴吸附" aria-pressed={snapping} disabled={locked} onClick={() => setSnapping(!snapping)}><FontAwesomeIcon icon={faMagnet} /></Button>
      <label>时间轴帧率<SelectField aria-label="时间轴帧率" disabled={locked} value={String(version.frameRate ?? 30)} onChange={(event) => editor.updateVersion({ ...version, frameRate: Number(event.target.value) })}>{[24, 25, 30, 50, 60].map((rate) => <SelectOption key={rate} value={String(rate)}>{rate} fps</SelectOption>)}</SelectField></label>
      <label className="assembly-zoom"><FontAwesomeIcon icon={faMagnifyingGlass} /><input aria-label="时间轴缩放" type="range" min={12} max={100} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div>
      <AssemblyTimeline version={version} disabled={locked} assets={props.assets} snapping={snapping} onChange={editor.updateVersion} selectedCaption={selectedCaption} onSelectCaption={(id) => { setSelectedCaption(id); setInspector('subtitles'); setSourceId(null) }} onAddAudio={(asset, time, trackId) => { setSourceId(null); void editor.addVideo(asset, time, trackId) }} onAddVideo={(asset, beforeId) => { setSourceId(null); void editor.addVideo(asset, 0, undefined, beforeId) }} onReorder={(source, target, after) => {
        const next = reorderClips(version, source, target, after)
        if (next !== version) { editor.updateVersion(next); editor.setSelected(source); setSourceId(null) }
      }} selected={inspector === 'clip' ? clip?.id : undefined} selectedSound={selectedSound} onSelectSound={(id) => { setSoundSelection({ versionId: version.id, id }); setSourceId(null); setInspector('sounds') }} zoom={zoom} position={position} onSeek={seek} onSelect={(id) => { setSoundSelection(null); setSourceId(null); editor.setSelected(id); setInspector('clip') }} />
      <footer className="assembly-timeline-footer"><span>{version.clips.length} 个片段 · {timecode(totalDuration(version))}</span><span>原片保留 · 非破坏性编辑</span></footer>
    </section>
    {switching && <Dialog title="切换排片工程" className="assembly-switch-dialog" onClose={() => setSwitching(false)}><Input autoFocus aria-label="搜索排片工程" placeholder="搜索集数或工程名称" value={episodeSearch} onChange={(event) => setEpisodeSearch(event.target.value)} /><div className="assembly-quick-results">{ordered.filter((item) => `${item.episode ?? ''} ${item.title}`.toLowerCase().includes(episodeSearch.trim().toLowerCase())).map((item) => <Button variant="ghost" key={item.id} disabled={locked} onClick={() => { if (item.id === props.document.id) setSwitching(false); else void navigate(() => { setSwitching(false); props.onOpen(item) }) }}>{item.episode === null ? '未分集' : `第 ${item.episode} 集`} · {item.title}</Button>)}</div></Dialog>}
    {exportSettingsOpen && <AssemblyExportSettings initial={exportOptions} onClose={() => setExportSettingsOpen(false)} onConfirm={(configuration) => {
      setExportOptions(configuration); setExportSettingsOpen(false); void exportVideo(configuration)
    }} />}
    {insertingTitle && <AssemblyInsertTitle version={version} position={position} onChange={editor.updateVersion} onClose={() => setInsertingTitle(false)} onSelect={(id) => { editor.setSelected(id); setInspector('clip'); setSourceId(null) }} />}
    {dialog && <Dialog title={dialog === 'metadata' ? '修改工程信息' : '另存剪辑版本'} onClose={() => setDialog(null)}><form className="assembly-form" onSubmit={details.handleSubmit(commitDialog)}><label>名称<Input autoFocus maxLength={dialog === 'version' ? 80 : 150} {...details.register('name')} /></label>{dialog === 'metadata' && <label>集数（可留空）<Input inputMode="numeric" {...details.register('episode')} /></label>}{(dialogError || details.formState.errors.name || details.formState.errors.episode) && <p role="alert" className="field-error">{dialogError || details.formState.errors.name?.message || details.formState.errors.episode?.message}</p>}<Button type="submit">确认</Button></form></Dialog>}
  </section></AssemblyPlaybackScope>
}

