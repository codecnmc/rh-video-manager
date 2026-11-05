import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faClapperboard, faChevronLeft, faChevronRight, faRotateRight, faArrowUpRightFromSquare, faLock } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyContent, AssemblyDocument } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Dialog } from '@/components/ui/dialog'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAssembly } from './use-assembly'
import { currentVersion, pendingSounds, timecode, totalDuration } from './assembly-state'
import { AssemblyEditor } from './AssemblyEditor'
import { useAssemblyWindows } from './use-assembly-windows'
import { desktop, unwrap } from '@/shared/lib/desktop'
import './assembly.css'

const createSchema = z.object({ title: z.string().trim().min(1, '请输入工程名称').max(150), episode: z.string().regex(/^$|^[1-9]\d{0,5}$/, '集数应为 1 至 999999，或留空') })
type CreateValues = z.infer<typeof createSchema>

export function AssemblyLibrary({ projectId, onDirty, onNotice, active = true, detached = false, initialDocumentId, windowRequest = 0 }: {
  projectId: string | null; onDirty: (value: boolean) => void; onNotice: (message: string) => void
  active?: boolean; detached?: boolean; initialDocumentId?: string; windowRequest?: number
}) {
  const library = useAssembly(projectId)
  const windows = useAssemblyWindows()
  const client = useQueryClient()
  const selection = useQuery({ queryKey: ['assembly-selection', projectId], queryFn: async () => unwrap(await desktop().assemblySelection(projectId)), retry: false })
  const restored = useRef(false)
  const wasLocked = useRef(false)
  const resumeGeneration = useRef(0)
  const [resuming, setResuming] = useState(false)
  const owned = windows.data?.locks.find((target) => target.projectId === projectId)
  const locked = !detached && !!owned
  const [editing, setEditing] = useState<AssemblyDocument | null>(null)
  const [editorSession, setEditorSession] = useState(0)
  const [creating, setCreating] = useState(false)
  const [choosingWindow, setChoosingWindow] = useState(false)
  const [openingWindow, setOpeningWindow] = useState(false)
  const openingWindowPending = useRef(false)
  const handledWindowRequest = useRef(0)
  const editorWindowOpener = useRef<(() => Promise<void>) | null>(null)
  const registerWindowOpener = useCallback((action: (() => Promise<void>) | null) => { editorWindowOpener.current = action }, [])
  const [recent, setRecent] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('episode')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [jump, setJump] = useState('1')
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { title: '', episode: '' } })
  const documents = library.documents.data ?? []
  useEffect(() => { if (!active || locked) setCreating(false) }, [active, locked])
  function remember(id: string | null) {
    client.setQueryData(['assembly-selection', projectId], id)
    void desktop().selectAssembly({ projectId, id }).then(unwrap).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '选集位置保存失败'))
  }
  function open(document: AssemblyDocument) {
    if (locked || !windows.data) return
    restored.current = true
    setEditing(document)
    setEditorSession((value) => value + 1)
    setRecent((ids) => [document.id, ...ids.filter((id) => id !== document.id)].slice(0, 5))
    remember(document.id)
  }
  useEffect(() => {
    if (restored.current || !windows.data || locked || !library.documents.isSuccess || !selection.isSuccess) return
    restored.current = true
    const id = initialDocumentId ?? selection.data
    const document = documents.find((item) => item.id === id)
    if (document) setEditing(document)
  }, [windows.data, locked, library.documents.isSuccess, documents, selection.isSuccess, selection.data, initialDocumentId])
  useEffect(() => {
    if (locked) {
      resumeGeneration.current += 1
      wasLocked.current = true
      // 接管前已保存，主窗口不保留可写的旧快照。
      setEditing(null); onDirty(false)
    } else if (wasLocked.current && windows.data) {
      wasLocked.current = false
      restored.current = true
      setResuming(true)
      const generation = ++resumeGeneration.current
      void Promise.all([library.documents.refetch({ throwOnError: true }), selection.refetch({ throwOnError: true })]).then(([fresh, selected]) => {
        if (generation !== resumeGeneration.current) return
        const document = fresh.data?.find((item) => item.id === selected.data)
        setEditing(document ?? null); setEditorSession((value) => value + 1)
      }).catch(() => onNotice('读取独立窗口的最新剪辑失败，请刷新后重试')).finally(() => {
        if (generation === resumeGeneration.current) setResuming(false)
      })
    }
  }, [locked, windows.data])
  async function openWindow(document: AssemblyDocument) {
    if (openingWindowPending.current) return
    openingWindowPending.current = true
    setOpeningWindow(true)
    try {
      await desktop().openAssemblyWindow({ projectId, id: document.id }).then(unwrap)
      setChoosingWindow(false)
      await windows.refetch()
    } finally { openingWindowPending.current = false; setOpeningWindow(false) }
  }
  useEffect(() => {
    if (!windowRequest || handledWindowRequest.current === windowRequest || detached) return
    if (windows.isPending || library.documents.isPending || selection.isPending || resuming) return
    handledWindowRequest.current = windowRequest
    if (windows.error || library.documents.error) { onNotice(windows.error?.message ?? library.documents.error?.message ?? '读取剪辑工程失败'); return }
    if (owned) {
      void desktop().openAssemblyWindow(owned).then(unwrap).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '无法唤回剪辑窗口'))
      return
    }
    if (editing) {
      if (editorWindowOpener.current) void editorWindowOpener.current()
      else onNotice('剪辑编辑器正在载入，请稍候重试')
      return
    }
    const document = documents.find((item) => item.id === selection.data) ?? (documents.length === 1 ? documents[0] : undefined)
    if (document) void openWindow(document).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '打开独立剪辑窗口失败'))
    else if (documents.length) setChoosingWindow(true)
    else onNotice('当前项目还没有排片工程，请先创建工程')
  }, [windowRequest, detached, windows.isPending, windows.error, owned, library.documents.isPending, library.documents.error, selection.isPending, selection.data, resuming, editing, documents, onNotice])
  async function create(values: CreateValues) {
    const versionId = crypto.randomUUID()
    const content: AssemblyContent = { title: values.title, episode: values.episode ? Number(values.episode) : null,
      activeVersionId: versionId, versions: [{ id: versionId, name: '初剪', clips: [], sounds: [] }] }
    try {
      open(await library.save.mutateAsync({ id: null, projectId, expectedRevision: 0, content }))
      setCreating(false); form.reset(); onNotice('排片工程已创建')
    } catch (error) { onNotice(error instanceof Error ? error.message : '创建失败') }
  }
  const visible = documents.filter((document) => {
    const version = currentVersion(document)
    return `${document.episode ?? ''} ${document.title}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === 'all' || filter === 'pending' && pendingSounds(version) > 0 || filter === 'editing' && version.clips.length > 0 || filter === 'empty' && version.clips.length === 0)
  }).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) :
    a.episode === null ? b.episode === null ? a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) : 1 : b.episode === null ? -1 :
      (sort === 'episode-desc' ? b.episode - a.episode : a.episode - b.episode) || a.title.localeCompare(b.title, 'zh-CN', { numeric: true }))
  const pages = Math.max(1, Math.ceil(visible.length / size))
  const currentPage = Math.min(page, pages)
  const rows = visible.slice((currentPage - 1) * size, currentPage * size)
  if (!windows.data) return <section className="assembly-session-status"><p>{windows.error?.message ?? '正在读取剪辑窗口状态'}</p><Button onClick={() => void windows.refetch()}>重新载入</Button></section>
  if (locked && owned) return <section className="assembly-session-status" role="status"><FontAwesomeIcon icon={faLock} /><h2>此项目已在独立窗口剪辑</h2>
    <p>{documents.find((item) => item.id === owned.id)?.title ?? '剪辑工程'}</p><Button onClick={() => void desktop().openAssemblyWindow(owned).then(unwrap).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '无法唤回剪辑窗口'))}><FontAwesomeIcon icon={faArrowUpRightFromSquare} />切换到剪辑窗口</Button></section>
  if (resuming) return <section className="assembly-session-status" role="status">正在读取独立窗口的最新剪辑</section>
  if (editing) return <AssemblyEditor key={`${editing.id}-${editorSession}`} document={editing} documents={documents} assets={library.assets.data ?? []} mcpStatus={library.mcp.data}
    active={active} onOpenWindow={detached ? undefined : openWindow} registerWindowOpener={registerWindowOpener}
    assetsLoading={library.assets.isPending} assetsError={library.assets.error?.message} saving={library.save.isPending} importing={library.importMedia.isPending}
    onReloadAssets={() => void library.assets.refetch()} onImport={(kind) => library.importMedia.mutateAsync(kind)}
    onSave={async (content, expectedRevision) => { const saved = await library.save.mutateAsync({ id: editing.id, projectId, content, expectedRevision }); setEditing(saved); return saved }}
    onBack={() => { setEditing(null); remember(null); onDirty(false) }} onOpen={open} onDirty={onDirty} onNotice={onNotice} />
  return <section className="assembly-library" aria-label="排片剪辑库">
    <header className="assembly-heading"><h1>排片剪辑库</h1><div className="button-row"><Button variant="ghost" size="icon" title="刷新工程列表" aria-label="刷新工程列表" onClick={() => void library.documents.refetch()}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Button onClick={() => setCreating(true)} disabled={library.documents.isPending}><FontAwesomeIcon icon={faPlus} />新建工程</Button></div></header>
    <div className="assembly-summary"><span>工程 <strong>{documents.length}</strong></span><span>已有编排 <strong>{documents.filter((item) => currentVersion(item).clips.length).length}</strong></span><span>声音待处理 <strong>{documents.filter((item) => pendingSounds(currentVersion(item))).length}</strong></span></div>
    {recent.length > 0 && <div className="assembly-recent"><span>最近打开</span>{recent.flatMap((id) => {
      const document = documents.find((item) => item.id === id)
      return document ? [<Button variant="ghost" key={id} onClick={() => open(document)}>{document.episode ? `第 ${document.episode} 集 · ` : ''}{document.title}</Button>] : []
    })}</div>}
    <div className="assembly-filters"><Input aria-label="搜索集数或工程名" placeholder="搜索集数或工程名称" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
      <SelectField aria-label="筛选工程状态" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><SelectOption value="all">全部工程</SelectOption><SelectOption value="pending">有待处理声音</SelectOption><SelectOption value="editing">已有编排</SelectOption><SelectOption value="empty">空工程</SelectOption></SelectField>
      <SelectField aria-label="工程排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}><SelectOption value="episode">集数从小到大</SelectOption><SelectOption value="episode-desc">集数从大到小</SelectOption><SelectOption value="updated">最近修改优先</SelectOption></SelectField></div>
    {library.documents.error && <p role="alert" className="field-error">{library.documents.error.message}</p>}
    <div className="assembly-table-scroll"><table className="assembly-table"><thead><tr><th>集数</th><th>工程名称</th><th>当前版本</th><th>时长</th><th>声音需求</th><th>最近修改</th><th>操作</th></tr></thead><tbody>
      {rows.map((document) => { const version = currentVersion(document); const pending = pendingSounds(version); return <tr key={document.id}>
        <td>{document.episode === null ? '未分集' : `第 ${String(document.episode).padStart(3, '0')} 集`}</td><td><Button variant="unstyled" className="assembly-title-button" onClick={() => open(document)}>{document.title}</Button><small>{version.clips.length} 个片段 · {document.versions.length} 个版本</small></td><td>{version.name}</td><td className="assembly-time">{timecode(totalDuration(version))}</td><td><span className={pending ? 'text-warning' : 'muted'}>{pending ? `${pending} 项待处理` : version.sounds.length ? '已确认' : '未标注'}</span></td><td>{new Date(document.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td><Button variant="ghost" onClick={() => open(document)}>编辑</Button></td>
      </tr> })}
      {!rows.length && <tr><td colSpan={7} className="assembly-empty"><FontAwesomeIcon icon={faClapperboard} /><p>{library.documents.isPending ? '正在读取工程' : search || filter !== 'all' ? '没有符合条件的工程' : '暂无排片工程'}</p></td></tr>}
    </tbody></table></div>
    <footer className="assembly-pagination"><span>共 {visible.length} 项</span><label>每页<SelectField aria-label="每页工程数" value={String(size)} onChange={(event) => { setSize(Number(event.target.value)); setPage(1) }}>{[10, 20, 50].map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}</SelectField></label>
      <Button variant="ghost" size="icon" aria-label="上一页" title="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><FontAwesomeIcon icon={faChevronLeft} /></Button><span>{currentPage} / {pages}</span><Button variant="ghost" size="icon" aria-label="下一页" title="下一页" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><FontAwesomeIcon icon={faChevronRight} /></Button>
      <label>跳至<Input type="number" min={1} max={pages} aria-label="页码" value={jump} onChange={(event) => setJump(event.target.value)} /></label><Button variant="outline" onClick={() => setPage(Math.min(pages, Math.max(1, Math.floor(Number(jump) || 1))))}>跳转</Button></footer>
    {creating && <Dialog title="新建排片工程" onClose={() => { if (!library.save.isPending) { setCreating(false); form.reset() } }}><form className="assembly-form" onSubmit={form.handleSubmit(create)}>
      <label>工程名称<Input autoFocus maxLength={150} {...form.register('title')} /></label><label>集数（可留空）<Input inputMode="numeric" {...form.register('episode')} /></label>
      {(form.formState.errors.title || form.formState.errors.episode) && <p role="alert" className="field-error">{form.formState.errors.title?.message ?? form.formState.errors.episode?.message}</p>}
      <Button type="submit" disabled={library.save.isPending}>创建工程</Button></form></Dialog>}
    {choosingWindow && <Dialog title="在新窗口打开排片工程" onClose={() => { if (!openingWindow) setChoosingWindow(false) }}>
      <div className="assembly-form">{documents.map((document) => <Button key={document.id} variant="outline" disabled={openingWindow} onClick={() => {
        void openWindow(document).catch((error: unknown) => onNotice(error instanceof Error ? error.message : '打开独立剪辑窗口失败'))
      }}><FontAwesomeIcon icon={faArrowUpRightFromSquare} />{document.title}</Button>)}</div>
    </Dialog>}
  </section>
}
