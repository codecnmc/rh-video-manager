import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPlay, faEye, faRotateRight, faTrash, faCopy, faMagnifyingGlass, faTableCells, faList, faFileLines, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { defaultImageSize, imageNodeFieldsSchema, type ImageBoard, type ImageNode } from '@contracts/image-generation'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Dialog } from '@/components/ui/dialog'
import { CopyableAssetImage } from '@/features/assets'
import { confirmAction } from '@/components/ui/confirmation'
import { ImageTaskEditor } from './ImageTaskEditor'
import { ImageAssetPicker } from './ImageAssetPicker'
import { editableImageTask, type CanvasTask } from './canvas-model'
import { acknowledgeTaskSave, acknowledgeTaskCopy, imageTaskFields, taskSessionDirty, taskSessionConflict, updateTaskFields, syncTaskSessions, type ImageTaskFields, type ImageTaskSessions } from './task-editor-state'
import { imageStatusLabel } from './image-labels'
import { ImageTaskElapsed } from './ImageTaskElapsed'
import type { ImageGenerationController } from './use-image-generation'
import './image-workbench.css'
import { canRegenerateImageTask, imageTaskVersions, imageVersionRoot, latestImageTaskIds } from './task-versions'
import { useImageCardSize } from './use-image-card-size'

const emptyNodes: ImageNode[] = []
const emptyAssets: Asset[] = []

export function ImageWorkspace({ board, header, control, onDirty, onNotice, registerSave }: {
  board: ImageBoard; header: ReactNode; control: ImageGenerationController; onDirty: (value: boolean) => void; onNotice: (message: string) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const nodes = control.nodes.data ?? emptyNodes
  const assets = control.assets.data ?? emptyAssets
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  // 版本关系只随持久化快照变化，不随提示词按键重复遍历历史链。
  const versionRoots = useMemo(() => new Map(nodes.map((node) => [node.id, imageVersionRoot(node.id, nodes)])), [nodes])
  const latestIds = useMemo(() => latestImageTaskIds(nodes.filter((node) => !board.hiddenNodeIds.includes(node.id))), [nodes, board.hiddenNodeIds])
  const [sessions, setSessions] = useState<ImageTaskSessions>({})
  const currentSessions = useRef(sessions)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ taskId: string } | null>(null)
  const [preview, setPreview] = useState<Asset | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [listView, setListView] = useState(false)
  const cardSize = useImageCardSize(onNotice)
  const [selected, setSelected] = useState<string[]>([])
  const [editorWidth, setEditorWidth] = useState(600)
  const [editorMaxWidth, setEditorMaxWidth] = useState(900)
  const editorDrag = useRef<{ x: number; width: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previewClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef(false)
  const [composing, setComposing] = useState(false)
  const failedAutosaves = useRef(new Map<string, string>())
  const fieldPublishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changeSessions = useCallback((transform: (previous: ImageTaskSessions) => ImageTaskSessions) => {
    const next = transform(currentSessions.current)
    if (next === currentSessions.current) return
    currentSessions.current = next
    if (fieldPublishTimer.current) { clearTimeout(fieldPublishTimer.current); fieldPublishTimer.current = null }
    setSessions(next)
  }, [])
  const onFields = useCallback((id: string, fields: ImageTaskFields) => {
    const previous = currentSessions.current
    const next = updateTaskFields(previous, id, fields)
    if (next === previous) return
    // 最新输入立即入内存供保存和离开保护读取，任务列表不跟随每个按键重绘。
    currentSessions.current = next
    if (fieldPublishTimer.current) clearTimeout(fieldPublishTimer.current)
    const wasDirty = previous[id] && taskSessionDirty(previous[id])
    const isDirty = taskSessionDirty(next[id]!)
    if (wasDirty !== isDirty) {
      fieldPublishTimer.current = null
      // 离开保护立即生效，只有列表展示可以延后。
      onDirty(Object.values(next).some(taskSessionDirty))
      startTransition(() => setSessions(next))
    } else {
      fieldPublishTimer.current = setTimeout(() => {
        fieldPublishTimer.current = null
        const snapshot = currentSessions.current
        startTransition(() => setSessions(snapshot))
      }, 250)
    }
  }, [onDirty])
  const unsaved = Object.values(sessions).some(taskSessionDirty)
  const validAssets = assets
  useEffect(() => () => { if (previewClickTimer.current) clearTimeout(previewClickTimer.current) }, [])
  useEffect(() => () => { if (fieldPublishTimer.current) clearTimeout(fieldPublishTimer.current) }, [])
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    // 窗口缩小时限制实际宽度，但保留用户拖动后的偏好供再次放大使用。
    const observer = new ResizeObserver(() => setEditorMaxWidth(Math.max(350, Math.min(900, content.clientWidth * 0.6))))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { onDirty(unsaved); return () => onDirty(false) }, [unsaved, onDirty])
  useEffect(() => {
    registerSave?.(async () => {
      if (control.busy || saving.current) return false
      for (const session of Object.values(currentSessions.current)) {
        if (!taskSessionDirty(session)) continue
        const parsed = imageNodeFieldsSchema.safeParse(session.fields)
        if (!parsed.success) { onNotice('请检查任务名称、提示词和参考图片后再保存'); return false }
        await save(session.id, parsed.data, false)
        const remaining = currentSessions.current[session.id]
        if (remaining && taskSessionDirty(remaining)) return false
      }
      return !Object.values(currentSessions.current).some(taskSessionDirty)
    })
    return () => registerSave?.(null)
  })
  useEffect(() => { if (control.nodes.data) changeSessions((previous) => syncTaskSessions(previous, control.nodes.data ?? [])) }, [control.nodes.data, changeSessions])
  useEffect(() => {
    if (control.busy || saving.current || composing) return
    const candidate = Object.values(sessions).find((session) => taskSessionDirty(session) &&
      !taskSessionConflict(session, nodes.find((node) => node.id === session.id)) &&
      (!session.base || editableImageTask(session.base)) && imageNodeFieldsSchema.safeParse(session.fields).success &&
      failedAutosaves.current.get(session.id) !== JSON.stringify(session.fields))
    if (!candidate) return
    const timer = setTimeout(() => {
      // 列表快照延后发布，旧计时器不能保存输入中途的过期内容。
      if (currentSessions.current[candidate.id] !== candidate) return
      void save(candidate.id, candidate.fields, false, true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [sessions, control.busy, control.nodes.data, composing])

  function newTask(seed: Partial<ImageTaskFields> = {}, sourceNodeId?: string) {
    if (control.busy || saving.current) return
    const id = crypto.randomUUID()
    const count = nodes.length + Object.values(currentSessions.current).filter((session) => !session.base).length
    const fields: ImageTaskFields = { title: `图片任务 ${count + 1}`, prompt: '', size: defaultImageSize, accountId: null, references: [], ...seed }
    changeSessions((previous) => ({ ...previous, [id]: { id, base: null, fields, open: true, ...(sourceNodeId ? { sourceNodeId } : {}) } }))
    setActiveId(id)
    setFilter('all')
    setSearch('')
  }
  function openTask(id: string): boolean {
    const existing = currentSessions.current[id]
    const target = nodes.find((item) => item.id === id)
    if (!existing && !target) return false
    changeSessions((previous) => ({ ...previous, [id]: existing ? { ...existing, open: true }
      : { id, base: target!, fields: imageTaskFields(target!), open: true } }))
    setActiveId(id)
    return true
  }
  function closeTask(id: string) {
    changeSessions((previous) => {
      const session = previous[id]
      return session ? { ...previous, [id]: { ...session, open: false } } : previous
    })
    if (activeId === id) setActiveId(null)
  }
  function appendReferences(id: string, items: Asset[]) {
    const node = nodes.find((item) => item.id === id)
    if (node && !editableImageTask(node) && !canRegenerateImageTask(node)) { onNotice('任务仍在途或受理不明，暂时不能修改参考图片'); return }
    if (!currentSessions.current[id] && !openTask(id)) return
    const session = currentSessions.current[id]
    if (!session) return
    const references = [...session.fields.references]
    for (const asset of items) if (!references.some((reference) => reference.assetId === asset.id)) references.push({ assetId: asset.id, expectedUpdatedAt: asset.updatedAt })
    if (references.length > 16) { onNotice('最多引用 16 张图片'); return }
    onFields(id, { ...session.fields, references })
  }
  function useAssets(ids: string[], taskId = activeId) {
    if (control.busy) return
    const items = [...new Set(ids)].map((id) => validAssets.find((asset) => asset.id === id))
    if (items.some((item) => !item)) { onNotice('部分素材已不可用'); return }
    const available = items.flatMap((asset) => asset ? [asset] : [])
    if (available.length > 16) { onNotice('最多引用 16 张图片'); return }
    const node = nodes.find((item) => item.id === taskId)
    if (!taskId || node && !editableImageTask(node) && !canRegenerateImageTask(node)) {
      newTask({ references: available.map((asset) => ({ assetId: asset.id, expectedUpdatedAt: asset.updatedAt })) })
    } else appendReferences(taskId, available)
  }
  async function save(id: string, fields: ImageTaskFields, generate: boolean, automatic = false) {
    const session = currentSessions.current[id]
    const node = nodes.find((item) => item.id === id)
    if (!session || node && !editableImageTask(node) && !canRegenerateImageTask(node) || saving.current || control.busy) return
    if (taskSessionConflict(session, node)) { onNotice('其他窗口已更新任务，本地修改已保留，请核对后重新载入最新记录'); return }
    saving.current = true
    if (automatic) failedAutosaves.current.set(id, JSON.stringify(fields))
    try {
      if (node && canRegenerateImageTask(node)) {
        if (!generate) {
          // 历史生成快照不可覆盖；编辑内容另存为关联的新草稿，不触发付费提交。
          const saved = await control.saveNode({ ...fields, id: crypto.randomUUID(), boardId: board.id, sourceNodeId: node.id })
          if (!saved) return
          changeSessions((previous) => acknowledgeTaskCopy(previous, node, saved))
          setActiveId(saved.id)
          onNotice('已另存为新草稿，原生成记录保留，尚未提交生成')
          return
        }
        const generated = await control.regenerate(node, fields)
        if (!generated) return
        changeSessions((previous) => ({ ...previous,
          [id]: { ...session, base: node, fields: imageTaskFields(node) },
          [generated.id]: { id: generated.id, base: generated, fields: imageTaskFields(generated), open: true }
        }))
        setActiveId(generated.id)
        return
      }
      const saved = await control.saveNode(session.base ? { ...fields, id, expectedRevision: session.base.revision } : { ...fields, id, boardId: board.id, ...(session.sourceNodeId ? { sourceNodeId: session.sourceNodeId } : {}) }, automatic)
      if (!saved) return
      failedAutosaves.current.delete(id)
      changeSessions((previous) => acknowledgeTaskSave(previous, id, fields, saved))
      if (generate) await control.submit([saved])
      else if (!automatic) onNotice('任务已保存，尚未提交生成')
    } finally { saving.current = false }
  }
  async function reloadTask(id: string) {
    const node = nodes.find((item) => item.id === id)
    if (!node || control.busy) return
    if (!await confirmAction('放弃此任务未保存的修改，载入其他窗口保存的最新版本？')) return
    failedAutosaves.current.delete(id)
    changeSessions((previous) => ({ ...previous, [id]: { id, base: node, fields: imageTaskFields(node), open: true } }))
  }
  async function pasteReferences(id: string, files: File[]) {
    if (control.busy) return
    const imported = await control.pasteImages(files)
    if (!imported?.length || !currentSessions.current[id]) return
    appendReferences(id, imported)
  }
  async function beforeRemove(ids: string[]) {
    if (control.busy || saving.current) return false
    const saved = nodes.filter((node) => ids.includes(node.id))
    if (saved.some((node) => !['draft', 'not_submitted', 'saved', 'resolved', 'output_unavailable'].includes(node.status))) {
      onNotice('排队、生成中、下载中或受理不明任务不能删除，请先撤回排队或核实远端状态')
      return false
    }
    const dirty = ids.filter((id) => { const session = currentSessions.current[id]; return session && taskSessionDirty(session) })
    if ((saved.length || dirty.length) && !await confirmAction(`删除所选任务？已有素材保留，不取消远端任务。${dirty.length ? `另有 ${dirty.length} 个任务的未保存修改将被放弃。` : ''}`)) return false
    if (saved.length && !await control.deleteNodes(saved)) return false
    changeSessions((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))))
    if (activeId && ids.includes(activeId)) setActiveId(null)
    return true
  }
  const canvasTasks: CanvasTask[] = nodes.map((node) => {
    const session = sessions[node.id]
    return session && editableImageTask(node) ? { ...node, ...session.fields, unsaved: taskSessionDirty(session) } : node
  })
  for (const session of Object.values(sessions)) if (!session.base && !nodes.some((node) => node.id === session.id)) canvasTasks.push({ ...session.fields,
    id: session.id, status: 'draft', accountSnapshot: null, assetId: null, review: 'pending', unsaved: true })
  const listedTasks = canvasTasks.filter((task) => !board.hiddenNodeIds.includes(task.id) && (!nodes.some((node) => node.id === task.id) || latestIds.has(task.id)))
  const drafts = nodes.filter((item) => editableImageTask(item) && selected.includes(item.id) && listedTasks.some((task) => task.id === item.id))
  const selectedDirty = drafts.some((item) => { const session = sessions[item.id]; return session && taskSessionDirty(session) })
  const groups = [
    { id: 'all', label: '全部', matches: (_task: CanvasTask) => true },
    { id: 'active', label: '生成中', matches: (task: CanvasTask) => ['queued', 'preparing', 'generating', 'downloading'].includes(task.status) },
    { id: 'draft', label: '待提交', matches: (task: CanvasTask) => editableImageTask(task) },
    { id: 'saved', label: '已完成', matches: (task: CanvasTask) => task.status === 'saved' },
    { id: 'error', label: '异常', matches: (task: CanvasTask) => ['acceptance_unknown', 'output_unavailable', 'resolved', 'not_submitted'].includes(task.status) }
  ]
  const visibleTasks = listedTasks.filter((task) => task.title.toLowerCase().includes(search.toLowerCase()) && groups.find((group) => group.id === filter)!.matches(task))
  const activeSession = activeId ? sessions[activeId] : undefined
  const sourceId = activeSession?.base?.sourceNodeId ?? activeSession?.sourceNodeId
  const sourceNode = sourceId ? nodesById.get(sourceId) : undefined
  const versionId = activeSession?.base?.id ?? activeSession?.sourceNodeId ?? activeSession?.id
  const versions = useMemo(() => versionId ? imageTaskVersions(versionId, nodes) : [], [versionId, nodes])
  function resizeEditor(width: number) {
    const available = contentRef.current?.clientWidth ?? 1000
    setEditorWidth(Math.max(350, Math.min(width, 900, available * 0.6)))
  }
  async function version(task: CanvasTask) {
    if (['queued', 'preparing', 'generating', 'downloading', 'acceptance_unknown'].includes(task.status)) {
      onNotice('任务仍在途或受理不明，请先核实结束并解除占用'); return
    }
    if (canRegenerateImageTask(task)) {
      if (!openTask(task.id)) return
      const session = currentSessions.current[task.id]
      if (session) await save(task.id, session.fields, true)
      return
    }
    newTask(imageTaskFields(task), nodes.some((node) => node.id === task.id) ? task.id : undefined)
  }
  return <div ref={contentRef} onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)} className={`image-creation-workspace image-workbench ${activeSession ? 'has-editor' : ''}`} style={{ '--image-editor-width': `${Math.min(editorWidth, editorMaxWidth)}px` } as CSSProperties}>
    <div className="image-workbench-main">
    {header}
    <div className="image-workbench-toolbar">
      <label className="image-task-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><input aria-label="搜索任务" placeholder="任务名称" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="image-workbench-filters" role="group" aria-label="任务状态">{groups.map((group) => <Button key={group.id} variant="ghost" aria-pressed={filter === group.id} onClick={() => setFilter(group.id)}>{group.label} {listedTasks.filter(group.matches).length}</Button>)}</div>
      <div className="button-row"><Button variant="ghost" size="icon" title="网格视图" aria-label="网格视图" aria-pressed={!listView} onClick={() => setListView(false)}><FontAwesomeIcon icon={faTableCells} /></Button><Button variant="ghost" size="icon" title="列表视图" aria-label="列表视图" aria-pressed={listView} onClick={() => setListView(true)}><FontAwesomeIcon icon={faList} /></Button>
        <input className="image-card-size" type="range" aria-label="缩略图大小" title={cardSize.error ? `缩略图尺寸读取失败：${cardSize.error}` : `缩略图大小：${cardSize.size}px`} min={220} max={400} step={20} value={cardSize.size} disabled={cardSize.disabled} onChange={(event) => cardSize.setSize(Number(event.target.value))} />
        <Button disabled={control.busy} onClick={() => newTask()}><FontAwesomeIcon icon={faPlus} />新建任务</Button></div>
    </div>
    <div className="image-workbench-content">
      <div className="image-task-grid-scroll"><div className={`image-task-grid ${listView ? 'is-list' : ''}`} style={{ gridTemplateColumns: listView ? '1fr' : `repeat(auto-fill, minmax(0, min(100%, ${cardSize.size}px)))` }}>
        {visibleTasks.map((task) => {
          const saved = nodesById.get(task.id)
          const result = task.assetId ? assetsById.get(task.assetId) : undefined
          const reference = assetsById.get(task.references[0]?.assetId ?? '')
          const thumbnail = result ?? reference
          return <article key={task.id} className="image-generation-card" data-active={Boolean(activeId && (versionRoots.get(activeId) ?? activeId) === (versionRoots.get(task.id) ?? task.id))}>
            <button className="image-generation-card-preview" onClick={(event) => {
              if (previewClickTimer.current) clearTimeout(previewClickTimer.current)
              if (!thumbnail || event.detail === 0) { openTask(task.id); return }
              // 延后单击展开，避免第一下改变网格布局，使第二下落不到原图。
              if (event.detail === 1) previewClickTimer.current = setTimeout(() => openTask(task.id), 400)
            }} onDoubleClick={() => {
              if (previewClickTimer.current) clearTimeout(previewClickTimer.current)
              if (thumbnail) setPreview(thumbnail)
            }} aria-label={`编辑 ${task.title}`}>
              {thumbnail ? <CopyableAssetImage assetId={thumbnail.id} disabled={thumbnail.archived} onNotice={onNotice} alt={result ? task.title : `引用图：${thumbnail.name}`} loading="lazy" /> : <FontAwesomeIcon icon={faEye} />}
              {!result && <span className="image-generation-preview-label">{reference ? '引用图 · ' : ''}{imageStatusLabel(task.status)}</span>}
            </button>
            <div className="image-generation-card-info"><button className="image-generation-card-title" onClick={() => openTask(task.id)}>{task.title}</button>
              <div className="image-generation-card-state"><span data-status={task.status}>{task.unsaved ? '未保存' : imageStatusLabel(task.status)}</span><ImageTaskElapsed node={saved ?? null} /></div>
              <p className="muted">{task.accountSnapshot?.name ?? control.accounts.data?.find((account) => account.id === task.accountId)?.name ?? (task.accountId === null ? '自动调度' : '账号不可用')} · {task.size}</p>
              {saved?.error && <p className="image-generation-card-error" title={saved.error}>{saved.error}</p>}
              <div className="image-generation-card-actions">
                <CheckboxField aria-label={`选择 ${task.title}`} checked={selected.includes(task.id)} disabled={!saved || !editableImageTask(task)} onChange={(event) => setSelected((previous) => event.target.checked ? [...new Set([...previous, task.id])] : previous.filter((id) => id !== task.id))} />
                {result && <Button variant="ghost" size="icon" title="查看结果原图" aria-label="查看结果原图" onClick={() => setPreview(result)}><FontAwesomeIcon icon={faEye} /></Button>}
                {['saved', 'resolved', 'not_submitted', 'output_unavailable'].includes(task.status) && <Button variant="ghost" title="重新生成，保留历史结果" disabled={control.busy} onClick={() => {
                  if (task.status === 'not_submitted') { if (openTask(task.id)) void save(task.id, currentSessions.current[task.id]!.fields, true) }
                  else void version(task)
                }}><FontAwesomeIcon icon={faRotateRight} />重新生成</Button>}
                {task.status === 'draft' && <Button variant="ghost" size="icon" title="复制任务" aria-label="复制任务" disabled={control.busy} onClick={() => version(task)}><FontAwesomeIcon icon={faCopy} /></Button>}
                {saved?.status === 'acceptance_unknown' && <Button variant="outline" disabled={control.busy} onClick={() => void control.resolveUnknown(saved)}>解除占用</Button>}
                {saved?.status === 'output_unavailable' && <Button variant="outline" disabled={control.busy} onClick={() => void control.retryOutput(saved)}>恢复下载</Button>}
                {saved?.status === 'queued' && <Button variant="outline" disabled={control.busy} onClick={() => void control.cancelQueued(saved)}>撤回排队</Button>}
                <Button variant="ghost" size="icon" title="删除任务" aria-label="删除任务" disabled={control.busy || !['draft', 'not_submitted', 'saved', 'resolved', 'output_unavailable'].includes(task.status)} onClick={() => void beforeRemove([task.id])}><FontAwesomeIcon icon={faTrash} /></Button>
              </div>
            </div>
          </article>
        })}
      </div>{control.nodes.isPending ? <p className="image-workbench-empty" role="status">正在读取任务</p> : !visibleTasks.length && <p className="image-workbench-empty">{nodes.length ? '没有符合条件的任务' : '暂无任务'}</p>}</div>
    </div>
    <footer className="image-workbench-footer"><span>任务 {listedTasks.length} · 已选 {drafts.length}</span><Button disabled={!drafts.length || drafts.length > 100 || control.busy || selectedDirty} onClick={() => void control.submit(drafts)}><FontAwesomeIcon icon={faPlay} />提交所选</Button></footer>
    </div>
    {activeSession && <aside id="image-task-inspector" className="image-workbench-editor image-workbench-inspector" aria-label="任务编辑">
        <div className="image-editor-resizer" role="separator" aria-label="调整任务编辑栏宽度" aria-orientation="vertical" aria-controls="image-task-inspector" aria-valuemin={350} aria-valuemax={editorMaxWidth} aria-valuenow={Math.min(editorWidth, editorMaxWidth)} tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            editorDrag.current = { x: event.clientX, width: event.currentTarget.parentElement?.getBoundingClientRect().width ?? editorWidth }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => { if (editorDrag.current) resizeEditor(editorDrag.current.width + editorDrag.current.x - event.clientX) }}
          onPointerUp={(event) => { editorDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onLostPointerCapture={() => { editorDrag.current = null }}
          onPointerCancel={() => { editorDrag.current = null }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            resizeEditor((event.currentTarget.parentElement?.getBoundingClientRect().width ?? editorWidth) + (event.key === 'ArrowLeft' ? 24 : -24))
          }} />
        <div className="image-workbench-editor-scroll">
        {sourceNode && <div className="image-task-source"><span>来源：{sourceNode.title} · {imageStatusLabel(sourceNode.status)}</span><div className="button-row">
          <Button variant="ghost" disabled={control.busy} onClick={() => openTask(sourceNode.id)}>查看来源任务</Button>
          {sourceNode.status === 'acceptance_unknown' && <Button variant="outline" disabled={control.busy} onClick={() => void control.resolveUnknown(sourceNode)}>核实结束并解除占用</Button>}
          {sourceNode.status === 'queued' && <Button variant="outline" disabled={control.busy} onClick={() => void control.cancelQueued(sourceNode)}>撤回来源排队</Button>}
        </div></div>}
        <ImageTaskEditor key={activeSession.id} session={activeSession} node={nodes.find((item) => item.id === activeSession.id) ?? activeSession.base} control={control} assets={assets}
        externalChanges={taskSessionConflict(activeSession, nodes.find((item) => item.id === activeSession.id))} onReload={() => void reloadTask(activeSession.id)}
        onFields={onFields} onSave={save} onClose={() => closeTask(activeSession.id)} onAddReferences={() => setPicker({ taskId: activeSession.id })}
        onPasteImages={(files) => { void pasteReferences(activeSession.id, files) }}
        onPreview={setPreview} />
        {versions.length > 0 && <section className="image-workbench-versions" aria-label="生成版本记录"><h3>生成记录 <span>{versions.length}</span></h3><div>{versions.map((node, index) => ({ node, number: index + 1 })).reverse().map(({ node, number }) => {
          const asset = assets.find((item) => item.id === node.assetId)
          const date = new Date(node.submittedAt ?? node.createdAt)
          const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          return <button key={node.id} aria-pressed={activeId === node.id} onClick={() => openTask(node.id)} title={`${node.title} · ${imageStatusLabel(node.status)}`}>
            <span className="image-version-preview" onDoubleClick={() => { if (asset) setPreview(asset) }}>{asset ? <CopyableAssetImage assetId={asset.id} disabled={asset.archived} onNotice={onNotice} alt={node.title} loading="lazy" /> : <FontAwesomeIcon icon={faFileLines} />}</span>
            <span className="image-version-info"><span className="image-version-title">版本 {number}{activeId === node.id && <span className="image-version-current">当前</span>}</span>
              <span className="image-version-meta">{node.status === 'draft' ? '草稿 · 尚未提交' : imageStatusLabel(node.status)}{time && ` · ${time}`}</span></span>
            <FontAwesomeIcon icon={faChevronRight} className="image-version-chevron" />
          </button>
        })}</div></section>}
        </div>
      </aside>}
    {picker && <ImageAssetPicker assets={validAssets} referenceMode selectedIds={picker.taskId ? sessions[picker.taskId]?.fields.references.map((ref) => ref.assetId) ?? [] : []}
      onClose={() => setPicker(null)} onAdd={(items) => { if (picker.taskId) useAssets(items.map((asset) => asset.id), picker.taskId); setPicker(null) }} />}
    {preview && <Dialog title={preview.name} className="image-original-dialog" onClose={() => setPreview(null)}><CopyableAssetImage assetId={preview.id} disabled={preview.archived} onNotice={onNotice} alt={preview.name} /></Dialog>}
  </div>
}
