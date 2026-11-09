import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faFileImport, faPen, faTrash, faBoxArchive, faRotateLeft, faFolderOpen, faCopy, faRotateRight, faArrowLeft, faArrowRight, faArrowUp, faFolderPlus, faFolder, faScissors, faPaste } from '@fortawesome/free-solid-svg-icons'
import type { Asset, AssetCategory, AssetFilter } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { confirmAction } from '@/components/ui/confirmation'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { InteractionHint } from '@/components/ui/interaction-hint'
import { useLibraryDrag } from './use-library-drag'
import { useLibraryMarquee } from './use-library-marquee'
import { useLibrary } from './use-library'
import { AssetEditor, mediaImport } from './AssetEditor'
import { AssetMedia } from './AssetMedia'
import { CopyableAssetImage } from './CopyableAssetImage'
import { AssetBrowser } from './AssetBrowser'
import { FolderNavigation } from './FolderNavigation'
import { folderOptions, folderPath, isWithinFolder } from './folders'
import './asset-explorer.css'

const kinds = [{ id: 'all', label: '全部' }, { id: 'image', label: '图片' }, { id: 'video', label: '视频' }, { id: 'audio', label: '音频' }, { id: 'prompt', label: '提示词' }] as const
type CutAsset = { id: string; expectedUpdatedAt: string }

export function LibraryPanel({ projectId, projects, onNotice, onDirty }: {
  projectId: string | null; projects: { id: string; name: string }[]; onNotice: (value: string) => void; onDirty: (value: boolean) => void
}) {
  const [scope, setScope] = useState(projectId ? 'project' : 'all')
  const [history, setHistory] = useState({ folders: ['none'], index: 0 })
  const category = history.folders[history.index] ?? 'none'
  const [kind, setKind] = useState<AssetFilter['kind']>()
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [cut, setCut] = useState<CutAsset[]>([])
  const [context, setContext] = useState<{ kind: 'assets'; items: Asset[] } | { kind: 'folder'; folder: AssetCategory | null } | { kind: 'blank' }>({ kind: 'blank' })
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [preview, setPreview] = useState<Asset | null>(null)
  const [editor, setEditor] = useState<Asset | 'import' | 'prompt' | null>(null)
  const [categoryEditor, setCategoryEditor] = useState<AssetCategory | 'new' | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryParent, setCategoryParent] = useState<string | null>(null)
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const reportDirty = useCallback((value: boolean) => onDirty(value), [onDirty])
  const filter: AssetFilter = { search, archived }
  if (scope === 'project' && projectId) filter.projectId = projectId
  if (scope === 'public') filter.projectId = null
  if (category !== 'all') filter.categoryId = category === 'none' ? null : category
  if (kind) filter.kind = kind
  const library = useLibrary(filter)
  const categories = library.categories.data ?? []
  const assets = library.assets.data ?? []
  const selectedCategory = categories.find((item) => item.id === category)
  const selection = assets.filter((asset) => selected.includes(asset.id))
  const single = selection.length === 1 ? selection[0] : undefined
  const visibleSelection = selection.map((asset) => asset.id)
  const marquee = useLibraryMarquee({ selected: visibleSelection, onSelect: setSelected,
    disabled: busy || library.assets.isPending || !!editor || !!preview || moving || !!categoryEditor,
    contextKey: JSON.stringify([projectId, scope, category, kind, search, archived, assets.map((asset) => [asset.id, asset.updatedAt]), categories])
  })
  const folders = categories.filter((folder) => folder.parentId === (selectedCategory?.id ?? null) && (!search.trim() || folder.name.toLowerCase().includes(search.trim().toLowerCase())))
  const breadcrumbs: AssetCategory[] = []
  const visited = new Set<string>()
  let ancestor = selectedCategory
  while (ancestor && !visited.has(ancestor.id)) {
    breadcrumbs.unshift(ancestor); visited.add(ancestor.id)
    const parentId = ancestor.parentId
    ancestor = categories.find((folder) => folder.id === parentId)
  }
  function navigate(id: string) {
    setHistory((current) => current.folders[current.index] === id ? current : { folders: [...current.folders.slice(0, current.index + 1), id], index: current.index + 1 })
    setSelected([]); setSearch(''); setError('')
  }
  function travel(delta: number) {
    setHistory((current) => ({ ...current, index: Math.max(0, Math.min(current.folders.length - 1, current.index + delta)) }))
    setSelected([]); setSearch('')
  }
  async function act(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败') } finally { operation.current = false; setBusy(false) }
  }
  function newFolder(parentId: string | null = selectedCategory?.id ?? null) { setCategoryName(''); setCategoryParent(parentId); setCategoryEditor('new') }
  function editFolder(folder = selectedCategory) {
    if (folder) { setCategoryName(folder.name); setCategoryParent(folder.parentId); setCategoryEditor(folder) }
  }
  function cutSelection() {
    setCut(selection.map((asset) => ({ id: asset.id, expectedUpdatedAt: asset.updatedAt })))
    onNotice(`已剪切 ${selection.length} 个素材`)
  }
  function pasteCut(destination?: string | null) {
    if (!cut.length || busy) return
    if (destination === undefined && category === 'all') { setError('请先打开目标文件夹或根目录'); return }
    void act(async () => {
      await library.move({ assets: cut, categoryId: destination === undefined ? selectedCategory?.id ?? null : destination })
      onNotice(`已移动 ${cut.length} 个素材`); setCut([]); setSelected([])
    })
  }
  function folderProjectId(id: string | null): string | null {
    if (!id) return scope === 'public' ? null : projectId
    const folder = categories.find((item) => item.id === id)
    if (!folder) throw new Error('目标文件夹不存在，请刷新素材库')
    return folder.projectId
  }
  function importFiles(files: File[], destination: string | null) {
    void act(async () => {
      const imported = await library.pasteFiles(files, folderProjectId(destination), destination)
      setArchived(false); setKind(undefined)
      if (imported[0]?.categoryId) navigate(imported[0].categoryId)
      onNotice(`已导入 ${imported.length} 个素材到素材库`)
    })
  }
  const drag = useLibraryDrag({ assets, categories, selected: visibleSelection, busy, onSelect: setSelected,
    onMoveAssets: (items, destination) => { void act(async () => { await library.move({ assets: items, categoryId: destination }); setSelected([]); setCut([]); onNotice(`已移动 ${items.length} 个素材`) }) },
    onMoveFolder: (folder, destination) => { void act(async () => { await library.moveCategory(folder.id, destination); onNotice('文件夹已移动') }) },
    onImportFiles: importFiles
  })
  async function deleteFolder(folder: AssetCategory) {
    if (await confirmAction(`删除空文件夹「${folder.name}」？`)) void act(async () => { await library.deleteCategory(folder.id); if (category === folder.id) navigate(folder.parentId ?? 'none') })
  }
  async function deleteSingle() {
    if (!single || busy || !(await confirmAction(`删除「${single.name}」？引用中的素材不能删除，原始文件不受影响，受管文件和历史记录保留。`))) return
    void act(async () => { await library.remove(single.id); setSelected([]); onNotice('素材已删除，受管文件和历史记录保留') })
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"], [role="combobox"], [role="menu"]') || editor || categoryEditor || moving || preview || busy) return
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(assets.map((asset) => asset.id)) }
    if (modifier && event.key.toLowerCase() === 'x' && selection.length && selection.length <= 200) { event.preventDefault(); cutSelection() }
    if (modifier && event.key.toLowerCase() === 'v' && cut.length) { event.preventDefault(); pasteCut() }
    if (event.key === 'Escape') { setSelected([]); setCut([]) }
    if (event.key === 'F2' && single) { event.preventDefault(); setEditor(single) }
    if (event.key === 'Delete' && single) { event.preventDefault(); void deleteSingle() }
    if (event.altKey && event.key === 'ArrowLeft' && history.index > 0) { event.preventDefault(); travel(-1) }
    if (event.altKey && event.key === 'ArrowRight' && history.index < history.folders.length - 1) { event.preventDefault(); travel(1) }
  }
  return <section className="library-page asset-explorer" tabIndex={-1} onKeyDown={onKeyDown} onPaste={(event) => {
    if (busy || editor || categoryEditor || moving || preview || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void act(async () => {
      const imported = await library.pasteFiles(files, selectedCategory ? selectedCategory.projectId : scope === 'public' ? null : projectId, selectedCategory?.id ?? null)
      setArchived(false); setKind(undefined); setSearch('')
      const destination = imported[0]?.categoryId
      if (destination) navigate(destination)
      onNotice(`已粘贴 ${imported.length} 个素材到文件夹`)
    })
  }}>
    <div className="asset-explorer-commandbar">
      <Button size="small" disabled={busy} onClick={() => setEditor('import')}><FontAwesomeIcon icon={faFileImport} />导入</Button>
      <Button variant="outline" size="small" disabled={busy} onClick={() => newFolder()}><FontAwesomeIcon icon={faFolderPlus} />新建文件夹</Button>
      <Button variant="ghost" size="small" disabled={busy} onClick={() => setEditor('prompt')}><FontAwesomeIcon icon={faPlus} />提示词</Button>
      <span className="asset-command-divider" />
      <Button variant="ghost" size="icon" title="剪切所选素材" aria-label="剪切所选素材" disabled={busy || !selection.length || selection.length > 200} onClick={cutSelection}><FontAwesomeIcon icon={faScissors} /></Button>
      <Button variant="ghost" size="icon" title="粘贴剪切的素材" aria-label="粘贴剪切的素材" disabled={busy || !cut.length || category === 'all'} onClick={() => pasteCut()}><FontAwesomeIcon icon={faPaste} /></Button>
      <Button variant="ghost" size="icon" title="移动所选素材到文件夹" aria-label="移动所选素材到文件夹" disabled={busy || !selection.length || selection.length > 200} onClick={() => { setMoveTarget(selectedCategory?.id ?? ''); setMoving(true) }}><FontAwesomeIcon icon={faFolderOpen} /></Button>
      <Button variant="ghost" size="icon" title="编辑所选素材" aria-label="编辑所选素材" disabled={busy || !single} onClick={() => { if (single) setEditor(single) }}><FontAwesomeIcon icon={faPen} /></Button>
      <Button variant="ghost" size="icon" title="复制所选素材提示词" aria-label="复制所选素材提示词" disabled={busy || !single?.prompt} onClick={() => { if (single) void act(async () => { await library.copyPrompt(single.id); onNotice('提示词已复制') }) }}><FontAwesomeIcon icon={faCopy} /></Button>
      <Button variant="ghost" size="icon" title={archived ? '恢复所选素材' : '归档所选素材'} aria-label={archived ? '恢复所选素材' : '归档所选素材'} disabled={busy || !single} onClick={() => { if (single) void act(async () => { await library.archive(single.id, !archived); setSelected([]) }) }}><FontAwesomeIcon icon={archived ? faRotateLeft : faBoxArchive} /></Button>
      <Button variant="ghost" size="icon" title="删除所选素材" aria-label="删除所选素材" disabled={busy || !single} onClick={() => void deleteSingle()}><FontAwesomeIcon icon={faTrash} /></Button>
    </div>
    <div className="asset-explorer-addressbar"><div className="button-row">
      <Button variant="ghost" size="icon" title="后退" aria-label="后退" disabled={!history.index || busy} onClick={() => travel(-1)}><FontAwesomeIcon icon={faArrowLeft} /></Button>
      <Button variant="ghost" size="icon" title="前进" aria-label="前进" disabled={history.index >= history.folders.length - 1 || busy} onClick={() => travel(1)}><FontAwesomeIcon icon={faArrowRight} /></Button>
      <Button variant="ghost" size="icon" title="上一级" aria-label="上一级" disabled={!selectedCategory || busy} onClick={() => navigate(selectedCategory?.parentId ?? 'none')}><FontAwesomeIcon icon={faArrowUp} /></Button>
    </div><nav className="asset-address-path" aria-label="素材目录">
      <Button variant="unstyled" onClick={() => navigate('none')}><FontAwesomeIcon icon={faFolder} />素材库</Button>
      {category === 'all' && <span> / 全部素材</span>}{breadcrumbs.map((folder) => <span key={folder.id}> / <Button variant="unstyled" title={folder.name} onClick={() => navigate(folder.id)}>{folder.name}</Button></span>)}
    </nav><Button variant="ghost" size="icon" title="刷新" aria-label="刷新素材" disabled={busy} onClick={() => void act(library.refresh)}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Input aria-label="搜索当前目录素材" placeholder="搜索名称、标签、提示词" value={search} onChange={(event) => { setSearch(event.target.value); setSelected([]) }} />
    </div>
    <div className="asset-explorer-filters"><ToggleGroup type="single" value={kind ?? 'all'} onValueChange={(value) => { const item = kinds.find((candidate) => candidate.id === value); if (item) { setKind(item.id === 'all' ? undefined : item.id); setSelected([]) } }} aria-label="素材类型">{kinds.map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}</ToggleGroup>
      <SelectField aria-label="素材范围" value={scope} onChange={(event) => { setScope(event.target.value); setHistory({ folders: ['none'], index: 0 }); setSelected([]); setCut([]); setContext({ kind: 'blank' }); setSearch('') }}><SelectOption value="all">全部项目与公共素材</SelectOption>{projectId && <SelectOption value="project">当前项目</SelectOption>}<SelectOption value="public">公共素材</SelectOption></SelectField>
      <label className="checkbox-label"><CheckboxField checked={archived} onChange={(event) => { setArchived(event.target.checked); setSelected([]) }} />已归档</label>
    </div>
    <InteractionHint label="双击预览 · 右键素材或文件夹查看更多操作"><p>右键素材可复制图片或素材库 ID、打开文件位置、编辑和移动。右键文件夹可新建子文件夹、重命名或移动文件夹。Ctrl / Shift 可多选，空白处拖动可框选；选中素材后可用顶部工具栏剪切和移动。图片预览中也可右键复制。</p></InteractionHint>
    {(error || library.assets.error || library.categories.error) && <p className="field-error" role="alert">{error || library.assets.error?.message || library.categories.error?.message}</p>}
    <ContextMenu><ContextMenuTrigger asChild><div className="asset-library-layout" onDragStart={drag.onDragStart} onDragOver={drag.onDragOver} onDrop={drag.onDrop} onDragLeave={drag.onDragLeave} onDragEnd={drag.onDragEnd}
      onContextMenuCapture={(event) => {
        const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-asset-id], [data-folder-id]') : null
        const asset = assets.find((item) => item.id === node?.dataset.assetId)
        if (asset) {
          const items = selected.includes(asset.id) ? selection : [asset]
          setSelected(items.map((item) => item.id)); setContext({ kind: 'assets', items })
        } else if (node?.dataset.folderId && node !== event.currentTarget.querySelector('.asset-library-content')) {
          setContext({ kind: 'folder', folder: categories.find((folder) => folder.id === node.dataset.folderId) ?? null })
        } else { setSelected([]); setContext({ kind: 'blank' }) }
      }}><aside className="asset-directory-sidebar"><FolderNavigation categories={categories} selected={category} onSelect={navigate} dropTarget={drag.dropTarget} busy={busy} />
      <div className="asset-directory-actions"><Button variant="ghost" size="icon" title="重命名或移动当前文件夹" aria-label="重命名或移动当前文件夹" disabled={!selectedCategory || busy} onClick={() => editFolder()}><FontAwesomeIcon icon={faPen} /></Button>
        <Button variant="ghost" size="icon" title="删除当前空文件夹" aria-label="删除当前空文件夹" disabled={!selectedCategory || busy} onClick={async () => {
          if (selectedCategory && await confirmAction(`删除空文件夹「${selectedCategory.name}」？`)) void act(async () => { await library.deleteCategory(selectedCategory.id); navigate(selectedCategory.parentId ?? 'none') })
        }}><FontAwesomeIcon icon={faTrash} /></Button></div></aside>
      <div ref={marquee.ref} tabIndex={-1} className="asset-library-content" data-folder-id={category} data-drop-active={drag.dropTarget === category} aria-busy={busy || library.assets.isPending}>
        {library.assets.isPending ? <div className="queue-empty">正在读取素材库</div> : <AssetBrowser assets={assets} folders={folders} categories={categories} selected={visibleSelection} onSelect={setSelected} onOpenFolder={navigate} onOpenAsset={setPreview} busy={busy} dropTarget={drag.dropTarget} onPresentationChange={marquee.cancel} />}
        {marquee.rectangle && <div className="asset-marquee-selection" aria-hidden="true" style={marquee.rectangle} />}
      </div>
    </div></ContextMenuTrigger><ContextMenuContent>
      {context.kind === 'assets' ? <>
        <ContextMenuItem disabled={busy || context.items.length !== 1} onSelect={() => setPreview(context.items[0] ?? null)}><FontAwesomeIcon icon={faFolderOpen} />打开预览</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length !== 1} onSelect={() => setEditor(context.items[0] ?? null)}><FontAwesomeIcon icon={faPen} />重命名 / 编辑</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy || context.items.length > 200} onSelect={() => { setCut(context.items.map((item) => ({ id: item.id, expectedUpdatedAt: item.updatedAt }))); onNotice(`已剪切 ${context.items.length} 个素材`) }}><FontAwesomeIcon icon={faScissors} />剪切</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length > 200} onSelect={() => { setMoveTarget(selectedCategory?.id ?? ''); setMoving(true) }}><FontAwesomeIcon icon={faFolder} />移动到文件夹</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length !== 1 || context.items[0]?.kind === 'prompt'} onSelect={() => { const item = context.items[0]; if (item) void act(() => library.reveal(item.id)) }}><FontAwesomeIcon icon={faFolderOpen} />在资源管理器中显示</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length !== 1 || context.items[0]?.kind !== 'image' || context.items[0]?.archived} onSelect={() => { const item = context.items[0]; if (item) void act(async () => { await library.copyImage(item.id); onNotice('图片已复制') }) }}><FontAwesomeIcon icon={faCopy} />复制图片</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length !== 1} onSelect={() => { const item = context.items[0]; if (item) void act(async () => { await library.copyId(item.id); onNotice('素材库 ID 已复制') }) }}><FontAwesomeIcon icon={faCopy} />复制素材库 ID</ContextMenuItem>
        <ContextMenuItem disabled={busy || context.items.length !== 1 || !context.items[0]?.prompt} onSelect={() => { const item = context.items[0]; if (item) void act(async () => { await library.copyPrompt(item.id); onNotice('提示词已复制') }) }}><FontAwesomeIcon icon={faCopy} />复制提示词</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy || context.items.length !== 1} onSelect={() => { const item = context.items[0]; if (item) void act(async () => { await library.archive(item.id, !item.archived); setSelected([]) }) }}><FontAwesomeIcon icon={faBoxArchive} />{archived ? '恢复' : '归档'}</ContextMenuItem>
        <ContextMenuItem className="destructive" disabled={busy || context.items.length !== 1} onSelect={() => void deleteSingle()}><FontAwesomeIcon icon={faTrash} />删除</ContextMenuItem>
      </> : context.kind === 'folder' ? <>
        <ContextMenuItem disabled={busy} onSelect={() => navigate(context.folder?.id ?? 'none')}><FontAwesomeIcon icon={faFolderOpen} />打开文件夹</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => newFolder(context.folder?.id ?? null)}><FontAwesomeIcon icon={faFolderPlus} />新建子文件夹</ContextMenuItem>
        <ContextMenuItem disabled={busy || !cut.length} onSelect={() => pasteCut(context.folder?.id ?? null)}><FontAwesomeIcon icon={faPaste} />粘贴剪切的素材</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy || !context.folder} onSelect={() => { if (context.folder) editFolder(context.folder) }}><FontAwesomeIcon icon={faPen} />重命名 / 移动文件夹</ContextMenuItem>
        <ContextMenuItem className="destructive" disabled={busy || !context.folder} onSelect={() => { if (context.folder) void deleteFolder(context.folder) }}><FontAwesomeIcon icon={faTrash} />删除空文件夹</ContextMenuItem>
      </> : <>
        <ContextMenuItem disabled={busy} onSelect={() => newFolder()}><FontAwesomeIcon icon={faFolderPlus} />新建文件夹</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => setEditor('import')}><FontAwesomeIcon icon={faFileImport} />导入素材</ContextMenuItem>
        <ContextMenuItem disabled={busy || !cut.length || category === 'all'} onSelect={() => pasteCut()}><FontAwesomeIcon icon={faPaste} />粘贴剪切的素材</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => void act(library.refresh)}><FontAwesomeIcon icon={faRotateRight} />刷新</ContextMenuItem>
        <ContextMenuItem disabled={busy || !assets.length} onSelect={() => setSelected(assets.map((item) => item.id))}>全选素材</ContextMenuItem>
      </>}
    </ContextMenuContent></ContextMenu>
    <div className="asset-explorer-status" role="status"><span>{selection.length ? `已选择 ${selection.length} 个素材` : `${assets.length} 个素材`}</span>{cut.length > 0 && <span>已剪切 {cut.length} 个素材</span>}<span>{category === 'all' ? '全部素材' : folderPath(categories, selectedCategory?.id ?? null)}</span></div>
    {moving && <Dialog title={`移动 ${selection.length} 个素材`} onClose={() => { if (!busy) setMoving(false) }}><form onSubmit={(event) => {
      event.preventDefault(); void act(async () => { await library.move({ categoryId: moveTarget || null, assets: selection.map((asset) => ({ id: asset.id, expectedUpdatedAt: asset.updatedAt })) }); setMoving(false); setSelected([]); setCut([]); onNotice('素材已移动') })
    }}><label className="field-label" htmlFor="asset-move-target">目标文件夹</label><SelectField id="asset-move-target" value={moveTarget} disabled={busy} onChange={(event) => setMoveTarget(event.target.value)}><SelectOption value="">根目录</SelectOption>{folderOptions(categories.filter((folder) => selection.every((asset) => asset.projectId === folder.projectId))).map((folder) => <SelectOption key={folder.id} value={folder.id}>{folder.path}</SelectOption>)}</SelectField>
      {error && <p role="alert" className="field-error">{error}</p>}<div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={() => setMoving(false)}>取消</Button><Button type="submit" disabled={busy || !selection.length}>{busy ? '移动中' : '移动'}</Button></div></form></Dialog>}
    {preview && <Dialog title={preview.name} className="asset-preview-dialog" onClose={() => setPreview(null)}><div className="asset-explorer-preview">{preview.kind === 'image' ? <CopyableAssetImage assetId={preview.id} alt={preview.name} disabled={preview.archived} onNotice={onNotice} /> : <AssetMedia key={`${preview.id}-${preview.updatedAt}`} asset={preview} />}</div>{error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions">
      {preview.kind !== 'prompt' && <Button variant="outline" disabled={busy} onClick={() => void act(() => library.reveal(preview.id))}><FontAwesomeIcon icon={faFolderOpen} />在文件夹中显示</Button>}
      <Button onClick={() => { setEditor(preview); setPreview(null) }}><FontAwesomeIcon icon={faPen} />编辑</Button></div></Dialog>}
    {editor && <AssetEditor asset={typeof editor === 'string' ? null : editor} importing={editor === 'import'} projectId={selectedCategory ? selectedCategory.projectId : scope === 'public' ? null : projectId}
      projects={projects} categoryId={selectedCategory?.id ?? null} onDirty={reportDirty} onClose={() => setEditor(null)} onSave={async (value) => {
        if (typeof editor !== 'string') await library.update({ ...value, id: editor.id, expectedUpdatedAt: editor.updatedAt })
        else if (editor === 'import') { const imported = await library.importFiles(mediaImport(value)); if (!imported.length) return false; onNotice(`已导入 ${imported.length} 个素材`) }
        else { await library.savePrompt(value); onNotice('提示词已保存') }
      }} />}
    {categoryEditor && <Dialog title={categoryEditor === 'new' ? '新建文件夹' : '编辑文件夹'} onClose={() => { if (!categoryBusy) setCategoryEditor(null) }}><form onSubmit={(event) => {
      event.preventDefault(); setCategoryBusy(true)
      void act(async () => { await library.saveCategory({ id: categoryEditor === 'new' ? null : categoryEditor.id, name: categoryName, parentId: categoryParent,
        projectId: categoryEditor === 'new' ? folderProjectId(categoryParent) : categoryEditor.projectId }); setCategoryEditor(null) }).finally(() => setCategoryBusy(false))
    }}><label className="field-label" htmlFor="category-name">文件夹名称</label><Input id="category-name" required maxLength={60} autoFocus disabled={categoryBusy} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
      <label className="field-label" htmlFor="category-parent">上级文件夹</label><SelectField id="category-parent" disabled={categoryBusy} value={categoryParent ?? ''} onChange={(event) => setCategoryParent(event.target.value || null)}>
        <SelectOption value="">根目录</SelectOption>{folderOptions(categories.filter((folder) => categoryEditor === 'new' || folder.projectId === categoryEditor.projectId)).filter((item) => categoryEditor === 'new' || !isWithinFolder(categories, item.id, categoryEditor.id)).map((item) => <SelectOption key={item.id} value={item.id}>{item.path}</SelectOption>)}</SelectField>
      {error && <p role="alert" className="field-error">{error}</p>}<div className="dialog-actions"><Button variant="outline" disabled={categoryBusy} onClick={() => setCategoryEditor(null)}>取消</Button><Button type="submit" disabled={categoryBusy || !categoryName.trim()}>保存</Button></div></form></Dialog>}
  </section>
}
