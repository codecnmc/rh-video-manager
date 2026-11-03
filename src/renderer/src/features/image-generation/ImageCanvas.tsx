import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, NodeToolbar, ViewportPortal, SelectionMode,
  useReactFlow, applyNodeChanges, type Node, type NodeProps, type Edge, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faMinus, faExpand, faImage, faSpinner, faTrash, faEye, faWandMagicSparkles, faHand,
  faArrowPointer, faImages, faFileImport, faArrowRotateLeft, faArrowRotateRight, faFloppyDisk, faKeyboard, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import type { ImageBoard } from '@contracts/image-generation'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CopyableAssetImage } from '@/features/assets'
import { confirmAction } from '@/components/ui/confirmation'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import type { ImageGenerationController } from './use-image-generation'
import { imageStatusLabel } from './image-labels'
import { editableImageTask, placeCanvasItems, removeCanvasItems, type CanvasTask, type CanvasPoint } from './canvas-model'
import { useCanvasLayout } from './use-canvas-layout'
import { reconcileCanvasNodes, applyCanvasSelection } from './canvas-flow-state'
import '@xyflow/react/dist/style.css'

export type CanvasReferenceLink = { taskId: string; assetId: string }
export type CanvasPlacement = { key: string; ids: string[]; point?: CanvasPoint }
type CanvasData = { title: string; kind: 'task' | 'asset' | 'result'; imageId: string | null; status: string;
  account: string; prompt: string; editable: boolean; usable: boolean; selectionCount: number;
  onPreview: () => void; onUse: () => void; onRemove: () => void }
type CanvasNode = Node<CanvasData, 'image'>
type ReferenceEdge = Edge<{ reference?: CanvasReferenceLink }>

function ImageCanvasNode({ data, selected }: NodeProps<CanvasNode>) {
  return <article className={`image-canvas-node ${selected ? 'is-selected' : ''}`}>
    <NodeToolbar isVisible={selected && data.selectionCount === 1} position={Position.Top} offset={12}>
      <div className="image-node-toolbar nodrag nopan">
        {data.imageId && <Button variant="ghost" size="icon" title="查看原图" aria-label="查看原图" onClick={data.onPreview}><FontAwesomeIcon icon={faEye} /></Button>}
        {data.usable && <Button variant="ghost" onClick={data.onUse}><FontAwesomeIcon icon={faWandMagicSparkles} />用作参考</Button>}
        <Button variant="ghost" size="icon" title="移出画布 (Delete)，保留素材和任务" aria-label="移出画布" onClick={data.onRemove}><FontAwesomeIcon icon={faTrash} /></Button>
      </div>
    </NodeToolbar>
    {data.kind === 'task' && <Handle type="target" position={Position.Left} isConnectable={data.editable} title={data.editable ? '连接参考图片' : '已提交，参考输入已冻结'}><FontAwesomeIcon icon={faPlus} /></Handle>}
    {data.kind === 'task' && <Handle type="source" position={Position.Right} isConnectable={false} className="image-provenance-handle" />}
    {data.kind === 'result' && <Handle type="target" position={Position.Left} isConnectable={false} className="image-provenance-handle" />}
    <header><FontAwesomeIcon icon={faImage} /><strong title={data.title}>{data.title}</strong></header>
    <div className="image-canvas-preview">{data.imageId ? <CopyableAssetImage assetId={data.imageId} alt={data.title} loading="lazy" draggable={false} />
      : <div className="image-canvas-task-content"><FontAwesomeIcon icon={data.status === '生成中' || data.status === '下载归档中' ? faSpinner : faWandMagicSparkles} spin={data.status === '生成中' || data.status === '下载归档中'} /><p>{data.prompt || '待填写提示词'}</p></div>}</div>
    <footer><span>{data.status}</span><span title={data.account}>{data.account}</span></footer>
    {data.imageId && <Handle type="source" position={Position.Right} isConnectable={data.usable} title={data.usable ? '拖动连接到图片任务' : '参考图片不可用'}><FontAwesomeIcon icon={faPlus} /></Handle>}
  </article>
}
const nodeTypes = { image: ImageCanvasNode }
const initialFitOptions = { padding: 0.3, maxZoom: 0.85 }
const multiSelectionKeys = ['Control', 'Meta', 'Shift']
const selectPanButtons = [1]
const handPanButtons = [0, 1]
const shortcuts = [
  ['Delete / Backspace', '删除所选任务或移出图片，或解除所选参考连线'], ['Esc', '取消选择'], ['Ctrl+A', '选择全部可见节点'],
  ['Ctrl+V', '导入剪贴板图片'], ['Ctrl+S', '保存画布布局'], ['Ctrl+Z / Ctrl+Shift+Z', '撤销 / 重做布局；不恢复已删除任务'],
  ['Space / 鼠标中键', '拖动画布'], ['Shift+拖动', '框选节点'], ['Ctrl / Shift+单击', '多选节点'], ['Ctrl+Enter', '保存当前任务并打开生成确认']
]

interface CanvasProps {
  board: ImageBoard; tasks: CanvasTask[]; assets: Asset[]; control: ImageGenerationController; children: (positions: Record<string, CanvasPoint>) => ReactNode;
  placement: CanvasPlacement | null; focusId: string | null;
  onLayoutDirty: (value: boolean) => void; onSelectTask: (id: string) => void; onUseAssets: (ids: string[]) => void;
  onBeforeRemove: (ids: string[]) => Promise<boolean>; onConnectReference: (link: CanvasReferenceLink) => void;
  onDisconnectReferences: (links: CanvasReferenceLink[]) => void; onPreview: (asset: Asset) => void;
  onNewTask: (point?: CanvasPoint) => void; onPickAssets: (point?: CanvasPoint) => void; onNotice: (message: string) => void;
}

function Canvas({ board, tasks, assets, control, placement, focusId, children, onLayoutDirty, onSelectTask, onUseAssets,
  onBeforeRemove, onConnectReference, onDisconnectReferences, onPreview, onNewTask, onPickAssets, onNotice }: CanvasProps) {
  const flow = useReactFlow<CanvasNode, ReferenceEdge>()
  const storage = useCanvasLayout(board, control)
  const { layout } = storage
  const root = useRef<HTMLDivElement>(null)
  const importedPlacement = useRef<string | null>(null)
  const importing = useRef(false)
  const contextPoint = useRef<CanvasPoint | undefined>(undefined)
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [mode, setMode] = useState<'select' | 'pan'>('select')
  const [showHelp, setShowHelp] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<string[] | null>(null)
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { onLayoutDirty(storage.dirty) }, [storage.dirty, onLayoutDirty])

  function centerPoint(): CanvasPoint {
    const bounds = root.current?.getBoundingClientRect()
    return flow.screenToFlowPosition({ x: (bounds?.left ?? 0) + (bounds?.width ?? 800) * 0.38,
      y: (bounds?.top ?? 0) + (bounds?.height ?? 600) * 0.22 })
  }
  function place(ids: string[], point?: CanvasPoint) {
    const target = point ?? centerPoint()
    // 新任务的面板属于节点悬浮层，放置时为它预留间距，不能让连续新建的任务叠在同一处。
    if (!point && ids.some((id) => !id.startsWith('asset:'))) {
      while (nodes.some((node) => Math.abs(node.position.x - target.x) < 720 && Math.abs(node.position.y - target.y) < 650)) target.x += 760
    }
    storage.change((previous) => placeCanvasItems(previous, ids, target))
    setSelectedIds(ids)
    if (!point) setPendingFocus(ids)
  }
  useEffect(() => {
    if (!placement || importedPlacement.current === placement.key) return
    importedPlacement.current = placement.key
    place(placement.ids, placement.point)
  }, [placement])
  useEffect(() => {
    if (!focusId) return
    storage.change((previous) => ({ ...previous, hiddenNodeIds: previous.hiddenNodeIds.filter((id) => id !== focusId && id !== `result:${focusId}`) }))
    setSelectedIds([focusId]); setPendingFocus([focusId])
  }, [focusId])

  const assetForNode = (id: string): string | null => id.startsWith('asset:') ? id.slice(6)
    : id.startsWith('result:') ? tasks.find((task) => task.id === id.slice(7))?.assetId ?? null : null
  async function remove(ids = selectedIds) {
    if (control.busy || !ids.length || !await onBeforeRemove(ids)) return
    storage.change((previous) => removeCanvasItems(previous, ids))
    setSelectedIds([])
    onNotice('已移除所选节点；任务同步从列表删除，已有素材保留')
  }
  const diagram = useMemo(() => {
    const items: CanvasNode[] = []
    const edges: ReferenceEdge[] = []
    const hidden = new Set(layout.hiddenNodeIds)
    const resultByAsset = new Map(tasks.flatMap((task) => task.assetId ? [[task.assetId, task.id] as const] : []))
    const sources = new Set([...Object.keys(layout.positions).filter((key) => key.startsWith('asset:')).map((key) => key.slice(6)), ...tasks.flatMap((task) => task.references.map((ref) => ref.assetId))])
    let ordinal = 0
    function data(id: string, fields: Omit<CanvasData, 'onPreview' | 'onUse' | 'onRemove' | 'selectionCount'>): CanvasData {
      return { ...fields, selectionCount: selectedIds.length, onPreview: () => { const asset = assets.find((item) => item.id === fields.imageId); if (asset) onPreview(asset) },
        onUse: () => { if (fields.imageId) onUseAssets([fields.imageId]) }, onRemove: () => void remove([id]) }
    }
    for (const assetId of sources) {
      if (resultByAsset.has(assetId) && !layout.positions[`asset:${assetId}`] && !hidden.has(`result:${resultByAsset.get(assetId)}`)) continue
      const id = `asset:${assetId}`
      if (hidden.has(id)) continue
      const asset = assets.find((item) => item.id === assetId)
      items.push({ id, type: 'image', position: layout.positions[id] ?? { x: 0, y: ordinal++ * 280 }, selected: selectedIds.includes(id),
        data: data(id, { kind: 'asset', title: asset?.name ?? '参考图片不可用', imageId: asset?.id ?? null, status: '图片素材', prompt: '',
          account: asset?.imageGeneration?.accountName ?? '', editable: false, usable: Boolean(asset) }) })
    }
    tasks.forEach((task, index) => {
      const account = task.accountSnapshot?.name ?? control.accounts.data?.find((item) => item.id === task.accountId)?.name ?? (task.accountId === null ? '自动调度' : '账号不可用')
      const position = layout.positions[task.id] ?? { x: 380 + Math.floor(index / 3) * 800, y: index % 3 * 650 }
      if (!hidden.has(task.id)) items.push({ id: task.id, type: 'image', position, selected: selectedIds.includes(task.id),
        data: data(task.id, { kind: 'task', title: task.title || '新建图片任务', imageId: null, status: task.unsaved ? '未保存' : imageStatusLabel(task.status),
          prompt: task.prompt, account, editable: editableImageTask(task), usable: false }) })
      for (const reference of task.references) {
        const sourceTask = resultByAsset.get(reference.assetId)
        const explicitAsset = layout.positions[`asset:${reference.assetId}`] && !hidden.has(`asset:${reference.assetId}`)
        const source = !explicitAsset && sourceTask && !hidden.has(`result:${sourceTask}`) ? `result:${sourceTask}` : `asset:${reference.assetId}`
        edges.push({ id: `ref:${reference.assetId}:${task.id}`, source, target: task.id, type: 'default', animated: false,
          selected: selectedEdges.includes(`ref:${reference.assetId}:${task.id}`), label: '参考图',
          style: task.unsaved ? { strokeDasharray: '6 4' } : {}, data: { reference: { taskId: task.id, assetId: reference.assetId } } })
      }
      if (task.assetId && !hidden.has(`result:${task.id}`)) {
        const id = `result:${task.id}`
        items.push({ id, type: 'image', position: layout.positions[id] ?? { x: position.x + 340, y: position.y }, selected: selectedIds.includes(id),
          data: data(id, { kind: 'result', title: task.title, imageId: task.assetId,
            status: imageStatusLabel(task.status),
            prompt: '', account, editable: false, usable: assets.some((asset) => asset.id === task.assetId) }) })
        edges.push({ id: `${task.id}:output`, source: task.id, target: id, type: 'default', selectable: false, label: '生成结果' })
      }
    })
    const visible = new Set(items.map((item) => item.id))
    return { nodes: items, edges: edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)) }
  }, [tasks, assets, layout, selectedIds, selectedEdges, control.accounts.data, control.busy, onPreview, onUseAssets])
  useEffect(() => setNodes((previous) => reconcileCanvasNodes(previous, diagram.nodes)), [diagram.nodes])
  useEffect(() => {
    const focused = nodes.filter((node) => pendingFocus?.includes(node.id))
    if (!focused.length || focused.some((node) => !node.measured?.width || !node.measured.height)) return
    const x = Math.min(...focused.map((node) => node.position.x))
    const y = Math.min(...focused.map((node) => node.position.y))
    const width = Math.max(...focused.map((node) => node.position.x + (node.data.kind === 'task' ? 640 : node.measured?.width ?? 264))) - x
    const height = Math.max(...focused.map((node) => node.position.y + (node.data.kind === 'task' ? 650 : node.measured?.height ?? 228))) - y
    const frame = requestAnimationFrame(() => { void flow.fitBounds({ x, y, width, height }, { padding: 0.2, duration: 200 }); setPendingFocus(null) })
    return () => cancelAnimationFrame(frame)
  }, [pendingFocus, nodes, flow])
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    const selections = changes.filter((change) => change.type === 'select')
    // 不再从 onSelectionChange 回写同一状态，避免内部 store 与受控节点交替覆盖选择。
    if (selections.length) setSelectedIds((previous) => applyCanvasSelection(previous, selections))
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange<ReferenceEdge>[]) => {
    const selections = changes.filter((change) => change.type === 'select')
    if (selections.length) setSelectedEdges((previous) => applyCanvasSelection(previous, selections))
  }, [])
  function validConnection(connection: Connection | ReferenceEdge): boolean {
    const source = diagram.nodes.find((node) => node.id === connection.source)
    const target = tasks.find((task) => task.id === connection.target)
    return Boolean(source?.data.usable && source.data.imageId && target && editableImageTask(target) && target.assetId !== source.data.imageId &&
      !target.references.some((ref) => ref.assetId === source.data.imageId) && target.references.length < 16)
  }
  async function importImages(files?: File[], point?: CanvasPoint) {
    if (control.busy || importing.current) return
    importing.current = true
    try {
      const imported = files ? await control.pasteImages(files) : await control.importImages()
      if (imported?.length) { place(imported.map((asset) => `asset:${asset.id}`), point); onNotice(`已导入 ${imported.length} 张图片到素材库和画布`) }
    } finally { importing.current = false }
  }
  function disconnect() {
    const links = diagram.edges.filter((edge) => selectedEdges.includes(edge.id)).flatMap((edge) => edge.data?.reference ? [edge.data.reference] : [])
    if (links.length) onDisconnectReferences(links)
    setSelectedEdges([])
  }
  const selectedAssets = selectedIds.flatMap((id) => { const assetId = assetForNode(id); return assetId ? [assetId] : [] })
  return <ContextMenu><ContextMenuTrigger asChild><div className={`image-canvas ${dragOver ? 'is-file-drag' : ''}`} ref={root} tabIndex={0} aria-label="图片创作画布" onContextMenu={(event) => {
    contextPoint.current = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
  }} onKeyDown={(event) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [role="combobox"], [role="dialog"]')) return
    const modifier = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') { setSelectedIds([]); setSelectedEdges([]) }
    if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(diagram.nodes.map((node) => node.id)) }
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); if (!control.busy) void storage.save() }
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) storage.redo(); else storage.undo() }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (selectedIds.length) void remove(); else disconnect() }
  }} onPaste={(event) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void importImages(files) }
  }} onDragOver={(event) => {
    if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes('application/workbench-image-asset')) return
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true)
  }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDragOver(false) }} onDropCapture={() => setDragOver(false)} onDrop={(event) => {
    event.preventDefault(); setDragOver(false)
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const files = Array.from(event.dataTransfer.files)
    if (files.length) { void importImages(files, point); return }
    const id = event.dataTransfer.getData('application/workbench-image-asset')
    if (assets.some((asset) => asset.id === id)) place([`asset:${id}`], point)
  }}>
    <ReactFlow<CanvasNode, ReferenceEdge> nodes={nodes} edges={diagram.edges} nodeTypes={nodeTypes} fitView fitViewOptions={initialFitOptions} minZoom={0.15} maxZoom={2}
      nodesConnectable edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode="Shift" multiSelectionKeyCode={multiSelectionKeys}
      panOnDrag={mode === 'pan' ? handPanButtons : selectPanButtons} selectionOnDrag={mode === 'select'} selectionMode={SelectionMode.Partial} panActivationKeyCode="Space"
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      isValidConnection={validConnection} onConnect={(connection) => { const assetId = assetForNode(connection.source); if (assetId) onConnectReference({ assetId, taskId: connection.target }) }}
      onNodeDragStop={(_event, _node, moved) => storage.change((previous) => ({ ...previous,
        positions: { ...previous.positions, ...Object.fromEntries(moved.map((node) => [node.id, { x: Math.max(-100000, Math.min(100000, node.position.x)), y: Math.max(-100000, Math.min(100000, node.position.y)) }])) } }))}
      onNodeClick={(event, node) => { root.current?.focus({ preventScroll: true }); if (event.ctrlKey || event.metaKey || event.shiftKey) return; if (node.data.kind === 'task') onSelectTask(node.id); else if (node.data.kind === 'result') onSelectTask(node.id.slice(7)) }}
      onNodeDoubleClick={(_event, node) => { const asset = assets.find((item) => item.id === node.data.imageId); if (asset) onPreview(asset) }}
      onPaneClick={() => { root.current?.focus({ preventScroll: true }); setSelectedIds([]); setSelectedEdges([]) }}>
      <Background gap={24} size={1} color="#d7e0e3" />
    </ReactFlow>
    <div className="image-canvas-tools">
      <Button variant="ghost" size="icon" title="新建图片任务" aria-label="新建图片任务" onClick={() => onNewTask()}><FontAwesomeIcon icon={faPlus} /></Button>
      <span className="image-tool-divider" />
      <Button variant="ghost" size="icon" title="选择 / 框选" aria-label="选择 / 框选" aria-pressed={mode === 'select'} onClick={() => setMode('select')}><FontAwesomeIcon icon={faArrowPointer} /></Button>
      <Button variant="ghost" size="icon" title="平移画布 (Space)" aria-label="平移画布" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}><FontAwesomeIcon icon={faHand} /></Button>
    </div>
    {storage.hasExternalChanges && <div className="image-canvas-conflict" role="alert"><span>其他窗口已更新布局。本地布局已保留，自动保存已暂停。</span>
      <Button variant="outline" disabled={control.busy || storage.saving} onClick={async () => {
        if (await confirmAction('放弃当前未保存的布局，载入最新画布布局？任务提示词不会被清除。')) storage.reload()
      }}><FontAwesomeIcon icon={faRotateRight} />重新载入布局</Button></div>}
    {selectedIds.length > 1 && <div className="image-multi-toolbar image-node-toolbar"><span>已选 {selectedIds.length} 项</span>
      <Button variant="ghost" size="icon" title="所选图片用作参考" aria-label="所选图片用作参考" disabled={!selectedAssets.length} onClick={() => onUseAssets(selectedAssets)}><FontAwesomeIcon icon={faWandMagicSparkles} /></Button>
      <Button variant="ghost" size="icon" title="删除任务 / 移出图片 (Delete)" aria-label="删除任务或移出图片" disabled={control.busy} onClick={() => void remove()}><FontAwesomeIcon icon={faTrash} /></Button></div>}
    {!!selectedEdges.length && !selectedIds.length && <div className="image-multi-toolbar image-node-toolbar"><Button variant="ghost" onClick={disconnect}><FontAwesomeIcon icon={faTrash} />解除参考连线</Button></div>}
    <div className="image-canvas-controls">
      <Button variant="ghost" size="icon" title="缩小" aria-label="缩小" onClick={() => void flow.zoomOut()}><FontAwesomeIcon icon={faMinus} /></Button>
      <Button variant="ghost" size="icon" title="放大" aria-label="放大" onClick={() => void flow.zoomIn()}><FontAwesomeIcon icon={faPlus} /></Button>
      <Button variant="ghost" size="icon" title="适应画布" aria-label="适应画布" onClick={() => void flow.fitView({ padding: 0.3, maxZoom: 1 })}><FontAwesomeIcon icon={faExpand} /></Button>
      <Button variant="ghost" size="icon" title="撤销布局 / 移出 (Ctrl+Z)" aria-label="撤销布局或移出" disabled={!storage.canUndo} onClick={storage.undo}><FontAwesomeIcon icon={faArrowRotateLeft} /></Button>
      <Button variant="ghost" size="icon" title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={!storage.canRedo} onClick={storage.redo}><FontAwesomeIcon icon={faArrowRotateRight} /></Button>
      <Button variant="ghost" size="icon" title={storage.hasExternalChanges ? '其他窗口已更新布局，请先重新载入' : storage.saving ? '正在自动保存画布' : storage.failed ? '自动保存失败，点击重试 (Ctrl+S)' : storage.dirty ? '等待自动保存画布 (Ctrl+S 可立即保存)' : '画布布局已自动保存'} aria-label="保存画布布局" className={storage.dirty ? 'is-dirty' : ''} disabled={!storage.dirty || control.busy || storage.saving || storage.hasExternalChanges} onClick={() => void storage.save()}><FontAwesomeIcon icon={storage.saving ? faSpinner : faFloppyDisk} spin={storage.saving} /></Button>
      <Button variant="ghost" size="icon" title="恢复全部移出的节点" aria-label="恢复全部移出的节点" disabled={!layout.hiddenNodeIds.length} onClick={() => storage.change((previous) => ({ ...previous, hiddenNodeIds: [] }))}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Button variant="ghost" size="icon" title="快捷键" aria-label="快捷键" onClick={() => setShowHelp(true)}><FontAwesomeIcon icon={faKeyboard} /></Button>
    </div>
    {!nodes.length && <div className="image-canvas-empty"><FontAwesomeIcon icon={faImages} /><h2>暂无画布节点</h2><div className="button-row"><Button variant="outline" disabled={control.busy} onClick={() => void importImages()}><FontAwesomeIcon icon={faFileImport} />导入图片</Button><Button onClick={() => onNewTask()}><FontAwesomeIcon icon={faPlus} />新建图片任务</Button></div></div>}
    {dragOver && <div className="image-canvas-drop-indicator" aria-hidden="true"><FontAwesomeIcon icon={faFileImport} /></div>}
    <ViewportPortal>{children(Object.fromEntries(nodes.map((node) => [node.id, node.position])))}</ViewportPortal>
    {showHelp && <Dialog title="画布快捷键" className="image-shortcuts-dialog" onClose={() => setShowHelp(false)}><dl>{shortcuts.map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl></Dialog>}
  </div></ContextMenuTrigger><ContextMenuContent>
    <ContextMenuItem disabled={control.busy} onSelect={() => onPickAssets(contextPoint.current)}><FontAwesomeIcon icon={faImages} />插入素材</ContextMenuItem>
    <ContextMenuItem disabled={control.busy} onSelect={() => void importImages(undefined, contextPoint.current)}><FontAwesomeIcon icon={faFileImport} />导入图片</ContextMenuItem>
    <ContextMenuItem disabled={control.busy} onSelect={() => onNewTask(contextPoint.current)}><FontAwesomeIcon icon={faPlus} />新建图片任务</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem disabled={!selectedAssets.length || control.busy} onSelect={() => onUseAssets(selectedAssets)}><FontAwesomeIcon icon={faWandMagicSparkles} />所选图片用作参考</ContextMenuItem>
    <ContextMenuItem disabled={!selectedIds.length || control.busy} onSelect={() => void remove()}><FontAwesomeIcon icon={faTrash} />删除任务 / 移出图片</ContextMenuItem>
    <ContextMenuItem disabled={!selectedEdges.length || control.busy} onSelect={disconnect}>解除参考连线</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem disabled={!storage.canUndo} onSelect={storage.undo}><FontAwesomeIcon icon={faArrowRotateLeft} />撤销布局操作</ContextMenuItem>
    <ContextMenuItem onSelect={() => setShowHelp(true)}><FontAwesomeIcon icon={faKeyboard} />快捷键</ContextMenuItem>
  </ContextMenuContent></ContextMenu>
}

export function ImageCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}
