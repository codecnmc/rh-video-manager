import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { SelectField } from '@/components/ui/select-field'
import { Input } from '@/components/ui/input'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilm, faPlus, faChevronDown, faBookOpen, faVideo, faImage, faImages, faListCheck, faClapperboard,
  faDiagramProject, faUsers, faPlug, faGear, faRotateRight, faTriangleExclamation, faXmark, faTrash, faPuzzlePiece, faPen, faBars, faAnglesLeft, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { Project, Workspace } from '@contracts/workspace'
import type { VideoDraft } from '@contracts/video'
import type { PreviewKind, PreviewNotificationTarget, PreviewSnapshot } from '@contracts/preview'
import { Button } from '@/components/ui/button'
import { AccountsPanel, PoolStatus } from '@/features/accounts'
import { WorkflowsPanel } from '@/features/workflows'
import { LibraryPanel } from '@/features/assets'
import { AssetMcpPanel } from '@/features/mcp'
import { ExtensionsPanel, ExtensionPage, useExtensions } from '@/features/extensions'
import { SettingsPanel, FirstUseGuide, type GuideView } from '@/features/settings'
import { SkillsPanel } from '@/features/skills'
import { useWorkspace } from './use-workspace'
import { usePreviews } from './use-previews'
import { resolveSavedDraft, useWorkbenchUi } from './workbench-store'
import { PreviewPanel } from './components/PreviewPanel'
import { VideoInspector } from '@/features/video'
import { ScriptLibrary } from '@/features/scripts'
import { AssemblyLibrary } from '@/features/assembly'
import { ImageGenerationLibrary, useImageGenerationUi } from '@/features/image-generation'
import { WorkbenchTasks } from './components/WorkbenchTasks'
import { TaskQueuePopover } from './components/TaskQueuePopover'
import { summarizeQueue } from './queue-state'
import { NameDialog } from './components/NameDialog'
import { Dialog } from '@/components/ui/dialog'
import { TaskHeaderStatus } from './components/TaskHeaderStatus'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { VideoDraftList } from './components/VideoDraftList'
import { reorderDraftSubset } from './draft-order'
import { desktop, unwrap } from '@/shared/lib/desktop'
import type { WorkbenchWindowContext } from '@contracts/workbench-windows'
import { useWorkbenchWindows } from './use-workbench-windows'

// 保留隐藏页的未保存会话，但不让工作台轮询和其他页面输入穿透到剪辑树。
const RetainedAssemblyPage = memo(function RetainedAssemblyPage({ projectId, active, onDirty, onNotice }: {
  projectId: string | null; active: boolean
  onDirty: (projectId: string | null, value: boolean) => void; onNotice: (message: string) => void
}) {
  const reportDirty = useCallback((value: boolean) => onDirty(projectId, value), [projectId, onDirty])
  return <div className="assembly-page-host" hidden={!active}>
    <AssemblyLibrary projectId={projectId} active={active} onDirty={reportDirty} onNotice={onNotice} />
  </div>
})

function newVideo(): VideoDraft {
  return { id: crypto.randomUUID(), title: '未命名视频', description: '', prompt: '', promptDocument: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto' }
}

export function Workbench() {
  const [context, setContext] = useState<WorkbenchWindowContext | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void desktop().workbenchWindowContext().then((result) => {
      if (!active) return
      const initial = unwrap(result)
      // 首次渲染前恢复目标，不能先显示/持久化默认首项目再跳回记忆位置。
      useWorkbenchUi.getState().selectProject(initial.projectId)
      useWorkbenchUi.getState().setView(initial.view)
      if (initial.boardId) useImageGenerationUi.getState().selectBoard(initial.projectId, initial.boardId)
      setContext(initial)
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : '无法恢复工作台位置') })
    return () => { active = false }
  }, [attempt])
  if (!context) return <div className="app-status"><h1>羊驼AI影视</h1><p>{error || '正在恢复工作台位置'}</p>{error && <Button onClick={() => setAttempt((value) => value + 1)}>重新载入</Button>}</div>
  return <WorkbenchContent detached={context.detached} />
}

function WorkbenchContent({ detached }: { detached: boolean }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [assemblyProjects, setAssemblyProjects] = useState<Array<string | null>>([])
  const [assemblyDirty, setAssemblyDirty] = useState<Record<string, boolean>>({})
  const onAssemblyDirty = useCallback((projectId: string | null, value: boolean) => {
    const key = projectId ?? 'public'
    setAssemblyDirty((current) => current[key] === value ? current : { ...current, [key]: value })
  }, [])
  const workspace = useWorkspace(dirty)
  const previews = usePreviews()
  const ui = useWorkbenchUi()
  const extensions = useExtensions()
  const [extensionSelection, setExtensionSelection] = useState<{ extensionId: string; pageId: string } | null>(null)
  const [renamingProject, setRenamingProject] = useState<{ id: string; name: string } | null>(null)
  const [notice, setNoticeState] = useState({ message: '', revision: 0 })
  const setNotice = useCallback((message: string) => {
    setNoticeState((current) => ({ message, revision: current.revision + 1 }))
  }, [])
  const [search, setSearch] = useState('')
  const [activeTask, setActiveTask] = useState<string | null>(null)
  const [notificationTarget, setNotificationTarget] = useState<PreviewNotificationTarget | null>(null)
  const [groupFilter, setGroupFilter] = useState('all')
  const [groupDialog, setGroupDialog] = useState<{ id?: string; name: string } | null>(null)
  const [managingGroups, setManagingGroups] = useState(false)
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  const [editorVersion, setEditorVersion] = useState(0)
  const [scratch, setScratch] = useState<Record<string, VideoDraft>>({})
  const onDirty = useCallback((value: boolean) => setDirty(value), [])
  const imageSave = useRef<(() => Promise<boolean>) | null>(null)
  const registerImageSave = useCallback((save: (() => Promise<boolean>) | null) => { imageSave.current = save }, [])
  const data = workspace.data
  const busy = workspace.save.isPending || workspace.remove.isPending || workspace.copy.isPending
  const project = data?.projects.find((item) => item.id === ui.projectId) ?? data?.projects[0]
  const groups = project?.videoGroups ?? []
  const groupedDrafts = (project?.videoDrafts ?? []).filter((item) => groupFilter === 'all' || (groupFilter === 'ungrouped' ? !item.groupId : item.groupId === groupFilter))
  const visibleDrafts = groupedDrafts.filter((item) => `${item.title}\n${item.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selectedVisibleCount = visibleDrafts.filter((item) => selectedDrafts.includes(item.id)).length
  const allVisibleSelected = visibleDrafts.length > 0 && selectedVisibleCount === visibleDrafts.length
  const savedDraft = resolveSavedDraft(project?.videoDrafts ?? [], ui)
  const draft = savedDraft ?? (project ? scratch[project.id] : undefined)
  const selectedBoardId = useImageGenerationUi((state) => state.boardByProject[project?.id ?? 'public'] ?? null)
  const windows = useWorkbenchWindows({ projectId: project?.id ?? null,
    view: ui.view === 'video' || ui.view === 'image-generation' ? ui.view : 'other',
    draftId: ui.view === 'video' ? draft?.id ?? null : null,
    boardId: ui.view === 'image-generation' ? selectedBoardId : null, dirty }, Boolean(data))
  const peers = windows.peers
  const sharedDocument = ui.view === 'image-generation' ? '画布' : '草稿'
  const tasks = (previews.data ?? []).filter((task) => task.projectId === project?.id)
  const allTasks = (previews.data ?? []).filter((task) => data?.projects.some((item) => item.id === task.projectId))
  const queueCounts = summarizeQueue(allTasks)
  const draftTasks = tasks.filter((task) => task.draftId === draft?.id).sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '') || b.id.localeCompare(a.id))
  const preview = draftTasks.find((task) => task.id === activeTask) ?? draftTasks[0]
  const selectedExtension = extensions.data?.find((item) => item.id === extensionSelection?.extensionId)
  const extensionTitle = selectedExtension?.manifest.contributes.pages?.find((page) => page.id === extensionSelection?.pageId)?.title ?? '插件页面'
  const headings = { video: '视频生成', 'image-generation': '素材生成', assembly: '排片剪辑库', 'script-library': '剧本库', settings: '设置', skills: 'Skill', 'extension-page': extensionTitle, assets: '素材库', accounts: '账号池', workflows: '工作流总览', mcp: 'MCP', extensions: '插件', tasks: '任务队列' }

  useEffect(() => {
    if (detached || !data) return
    void desktop().rememberWorkbenchProject(project?.id ?? null).then(unwrap).catch((failure: unknown) => {
      setNotice(failure instanceof Error ? failure.message : '项目位置保存失败')
    })
  }, [detached, project?.id, Boolean(data), setNotice])

  async function openProjectWindow() {
    if (!project) return
    try {
      unwrap(await desktop().openWorkbenchWindow({ projectId: project.id, view: 'video', boardId: null }))
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : '独立窗口打开失败') }
  }

  useEffect(() => {
    if (ui.view !== 'assembly' || !data) return
    const id = project?.id ?? null
    setAssemblyProjects((current) => current.includes(id) ? current : [...current, id])
  }, [ui.view, project?.id, !!data])

  useEffect(() => {
    if (project) setScratch((current) => current[project.id] ? current : { ...current, [project.id]: newVideo() })
  }, [project?.id])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty || Object.values(assemblyDirty).some(Boolean)) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, assemblyDirty])
  useEffect(() => {
    if (!notice.message) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  async function navigate(action: () => void) {
    if (busy) { setNotice('正在保存或删除，请稍候再切换'); return }
    if (dirty && !(await confirmAction(ui.view === 'image-generation' ? '当前内容尚未保存，是否保存修改后切换？' : '当前内容尚未保存，确定放弃修改并切换？', ui.view === 'image-generation' && imageSave.current ? () => imageSave.current?.() ?? Promise.resolve(false) : undefined))) return
    if (dirty) setEditorVersion((value) => value + 1)
    setDirty(false)
    action()
  }
  async function navigateGuide(view: GuideView): Promise<boolean> {
    if (ui.view === view) {
      if (ui.sidebarCollapsed) ui.toggleSidebar()
      return true
    }
    let changed = false
    await navigate(() => {
      ui.setView(view)
      if (ui.sidebarCollapsed) ui.toggleSidebar()
      changed = true
    })
    return changed
  }
  async function persist(next: Workspace) {
    // 编辑器分别清理自己的脏状态，保存视频不能清掉尚未保存的台词配置。
    try { await workspace.save.mutateAsync(next); setNotice('已保存到本地 SQLite') }
    catch (error) { setNotice(error instanceof Error ? error.message : '保存失败'); throw error }
  }
  async function saveVideo(nextDraft: VideoDraft) {
    if (!data || !project) return
    await persist({ ...data, projects: data.projects.map((item) => item.id === project.id ? { ...item,
      videoDrafts: item.videoDrafts.some((entry) => entry.id === nextDraft.id)
        ? item.videoDrafts.map((entry) => entry.id === nextDraft.id ? nextDraft : entry) : [...item.videoDrafts, nextDraft]
    } : item) })
    ui.selectDraft(nextDraft.id)
  }
  async function createEntity(name: string) {
    if (!data) return
    if (ui.dialog === 'project') {
      const created: Project = { id: crypto.randomUUID(), name, sample: false, episodes: [], videoDrafts: [] }
      await persist({ ...data, projects: [created, ...data.projects] })
      ui.selectProject(created.id); ui.setView('video'); setGroupFilter('all'); setSelectedDrafts([]); setSearch(''); setActiveTask(null)
    }
  }
  function newDraft() {
    if (!project) return
    navigate(() => { setScratch((current) => ({ ...current, [project.id]: { ...newVideo(), groupId: groups.some((item) => item.id === groupFilter) ? groupFilter : undefined } })); setActiveTask(null); ui.startDraft() })
  }
  async function saveGroup(name: string) {
    if (!data || !project || !groupDialog || busy || dirty) throw new Error('请先保存当前修改，再管理分集分组')
    if (groups.some((item) => item.name === name && item.id !== groupDialog.id)) throw new Error('分集分组名称已存在')
    const id = groupDialog.id ?? crypto.randomUUID()
    await persist({ ...data, projects: data.projects.map((item) => item.id === project.id ? { ...item,
      videoGroups: groupDialog.id ? groups.map((group) => group.id === id ? { ...group, name } : group) : [...groups, { id, name }]
    } : item) })
    setGroupFilter(id); setSearch(''); setSelectedDrafts([])
  }
  async function moveDrafts(groupId: string) {
    if (!data || !project || busy || dirty) { setNotice('请先保存当前修改，再移动草稿'); return }
    try {
      await persist({ ...data, projects: data.projects.map((item) => item.id === project.id ? { ...item,
        videoDrafts: item.videoDrafts.map((entry) => selectedDrafts.includes(entry.id) ? { ...entry, groupId: groupId === 'ungrouped' ? undefined : groupId } : entry)
      } : item) })
      setSelectedDrafts([])
    } catch { /* persist 已显示具体错误，保留勾选以便重试。 */ }
  }
  async function removeGroup(id: string, name: string) {
    if (!data || !project || busy || dirty) return
    if (!await confirmAction(`删除分组「${name}」？组内草稿将移到“未分组”，不会删除草稿。`)) return
    try {
      await persist({ ...data, projects: data.projects.map((item) => item.id === project.id ? { ...item,
        videoGroups: groups.filter((group) => group.id !== id),
        videoDrafts: item.videoDrafts.map((entry) => entry.groupId === id ? { ...entry, groupId: undefined } : entry)
      } : item) })
      if (groupFilter === id) setGroupFilter('ungrouped')
      setSelectedDrafts([])
    } catch { /* persist 已显示错误，保留弹窗以便重试。 */ }
  }
  async function copyDraft(draftId: string) {
    if (!data || !project || busy) return
    if (dirty) { setNotice('请先保存当前修改，再复制草稿'); return }
    try {
      const result = await workspace.copy.mutateAsync({ projectId: project.id, draftId, expectedRevision: data.revision })
      ui.selectDraft(result.draftId); setActiveTask(null); setSearch(''); setEditorVersion((value) => value + 1)
      setNotice('已复制草稿、参数和素材引用；未复制生成任务')
    } catch (error) { setNotice(error instanceof Error ? error.message : '草稿复制失败') }
  }
  async function reorderDrafts(ids: string[]) {
    if (!data || !project || busy || dirty || workspace.hasExternalChanges || search.trim()) {
      setNotice('请先保存修改并清除搜索，再调整草稿顺序')
      return
    }
    try {
      const videoDrafts = reorderDraftSubset(project.videoDrafts, visibleDrafts.map((item) => item.id), ids)
      await persist({ ...data, projects: data.projects.map((item) => item.id === project.id ? { ...item, videoDrafts } : item) })
    } catch (error) { setNotice(error instanceof Error ? error.message : '草稿排序失败') }
  }
  async function removeEntity(kind: 'project' | 'video', id: string, name: string) {
    if (!data || !project || busy) return
    if (kind === 'project' && assemblyDirty[project.id]) { setNotice('此项目有未保存的剪辑，请先回到剪辑库保存或放弃修改，再删除项目'); return }
    const detail = kind === 'project' ? '所属视频草稿和项目素材也会从列表移除。' : ''
    if (!(await confirmAction(`删除「${name}」？${detail}记录与受管文件会保留用于恢复，原始文件不受影响。${dirty ? '\n当前未保存的修改也会放弃。' : ''}`))) return
    try {
      await workspace.remove.mutateAsync({ kind, id, projectId: project.id, expectedRevision: data.revision })
      setDirty(false); setEditorVersion((value) => value + 1); setActiveTask(null)
      if (kind === 'project') {
        setScratch((current) => { const next = { ...current }; delete next[project.id]; return next })
        ui.selectProject(null)
        setGroupFilter('all'); setSelectedDrafts([]); setSearch('')
      } else if (kind === 'video') {
        setScratch((current) => ({ ...current, [project.id]: newVideo() }))
        ui.selectDraft(null)
      }
      setNotice('已删除，底层记录与文件保留用于恢复')
    } catch (error) { setNotice(error instanceof Error ? error.message : '删除失败') }
  }
  function selectTask(task: PreviewSnapshot, preferredKind?: PreviewKind) {
    const targetProject = data?.projects.find((item) => item.id === task.projectId)
    if (!targetProject?.videoDrafts.some((item) => item.id === task.draftId)) { setNotice('任务所属项目或草稿已不可用'); return }
    // 同草稿只切换预览，不能重挂载编辑器或清除未保存内容。
    if (project?.id === task.projectId && draft?.id === task.draftId && ui.view === 'video') {
      setActiveTask(task.id)
      if (preferredKind) ui.setPreviewKind(preferredKind)
      ui.setQueueOpen(false)
      return
    }
    navigate(() => {
      setEditorVersion((version) => version + 1)
      ui.selectProject(task.projectId); ui.selectDraft(task.draftId); ui.setView('video'); setActiveTask(task.id)
      setGroupFilter(targetProject.videoDrafts.find((item) => item.id === task.draftId)?.groupId ?? 'ungrouped')
      setSearch(''); setSelectedDrafts([]); ui.setQueueOpen(false)
      ui.setPreviewKind(preferredKind ?? (task.final ? 'final' : task.draft ? 'draft' : task.sampling ? 'sampling' : 'final'))
    })
  }

  useEffect(() => {
    if (!window.workbench) return
    return desktop().onPreviewNotification((target) => {
      setNotificationTarget(target)
      void previews.refetch()
    })
  }, [previews.refetch])
  useEffect(() => {
    // 等任务列表就绪后定位具体生成记录，不能回退到同草稿的另一次任务。
    if (!notificationTarget || !data || previews.isPending || previews.isFetching || busy) return
    const target = notificationTarget
    const task = previews.data?.find((item) => item.id === target.id && item.projectId === target.projectId && item.draftId === target.draftId)
    setNotificationTarget(null)
    if (!task) { setNotice('通知对应的任务已不可用，请在任务队列核对'); return }
    selectTask(task, target.kind)
  }, [notificationTarget, data, previews.data, previews.isPending, previews.isFetching, busy, dirty, project?.id, draft?.id, ui.view])

  if (workspace.isPending) return <div className="app-status"><FontAwesomeIcon icon={faFilm} /><h1>羊驼AI影视</h1><p>正在读取本地项目</p></div>
  if (!data) return <div className="app-status"><FontAwesomeIcon icon={faTriangleExclamation} /><h1>工作台无法载入</h1>
    <p>{workspace.error?.message ?? '没有可用数据'}</p><Button onClick={() => void workspace.refetch()}><FontAwesomeIcon icon={faRotateRight} />重新载入</Button></div>

  // 素材生成将页头放入任务区，右侧编辑栏才能独占标题栏下方的完整高度。
  const workspaceHeader = <header className="workspace-header"><div className="workspace-location"><Button variant="ghost" size="icon" title={ui.sidebarCollapsed ? '展开左侧菜单' : '收起左侧菜单'} aria-label={ui.sidebarCollapsed ? '展开左侧菜单' : '收起左侧菜单'} aria-expanded={!ui.sidebarCollapsed} aria-controls="workbench-sidebar" onClick={ui.toggleSidebar}><FontAwesomeIcon icon={ui.sidebarCollapsed ? faBars : faAnglesLeft} /></Button><nav className="breadcrumb" aria-label="当前位置">{['tasks', 'script-library', 'settings'].includes(ui.view) ? '工作台' : project?.name ?? '工作台'}<span>/</span>{headings[ui.view]}</nav>
    {ui.view !== 'image-generation' && <Button variant="ghost" size="icon" title="在新窗口打开当前项目" aria-label="在新窗口打开当前项目" disabled={!project || busy} onClick={() => void openProjectWindow()}><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></Button>}
  </div>
  <div className="window-presence" role="status" aria-live="polite">
    {windows.error ? <span className="text-warning" title={windows.error}>窗口状态不可用</span> : peers && peers.project.length > 0 && <span className={peers.editing.length ? 'text-warning' : 'muted'}
      title={peers.project.map((peer) => `窗口 ${peer.windowId} · ${peer.view === 'video' ? '视频草稿' : peer.view === 'image-generation' ? '素材画布' : '其他页面'} · ${peer.dirty ? '有未保存修改' : '已打开'}`).join('\n')}>
      {peers.document.length ? `同一${sharedDocument}另 ${peers.document.length} 个窗口${peers.editing.length ? ` · ${peers.editing.length} 个未保存` : ''}` : `此项目另 ${peers.project.length} 个窗口`}
      {ui.view === 'video' && ` · ${workspace.error ? '同步失败' : workspace.hasExternalChanges ? '有外部更新' : `版本 ${data.revision}`}`}
    </span>}
  </div>
  {ui.view === 'video' && <div className="button-row"><TaskHeaderStatus task={preview} onNotice={setNotice} />
    {workspace.hasExternalChanges && <span role="status" className="text-warning">已有外部新版本 · 本地修改未覆盖 · 请重新载入</span>}
    <Button variant="ghost" size="icon" title="重新载入视频草稿" aria-label="重新载入视频草稿" disabled={busy} onClick={async () => {
      if (dirty && !await confirmAction('放弃当前界面未保存的修改，载入已保存的最新草稿和参考素材？此操作不会覆盖外部更新，也不会更改生成记录。')) return
      try {
        await workspace.reload(); setDirty(false); setEditorVersion((value) => value + 1)
        setNotice('已载入最新视频草稿')
      } catch (error) { setNotice(error instanceof Error ? error.message : '重新载入失败') }
    }}><FontAwesomeIcon icon={faRotateRight} /></Button></div>}</header>

  return <Popover open={ui.queueOpen} onOpenChange={ui.setQueueOpen}><div className={`workbench${ui.sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="sidebar" id="workbench-sidebar" aria-label="主菜单"><div className="sidebar-scroll"><div className="sidebar-section-title project-heading"><span>项目</span><div className="button-row">
      <Button variant="ghost" size="icon" title={dirty ? '请先保存当前修改再重命名项目' : '重命名当前项目'} aria-label="重命名当前项目" disabled={!project || busy || dirty} onClick={() => { if (project) setRenamingProject({ id: project.id, name: project.name }) }}><FontAwesomeIcon icon={faPen} /></Button>
      <Button variant="ghost" size="icon" title="删除当前项目" aria-label="删除当前项目" disabled={!project || busy} onClick={() => { if (project) void removeEntity('project', project.id, project.name) }}><FontAwesomeIcon icon={faTrash} /></Button>
      <Button data-guide-target="new-project" variant="ghost" size="icon" title="新建项目" aria-label="新建项目" onClick={() => navigate(() => ui.setDialog('project'))}><FontAwesomeIcon icon={faPlus} /></Button></div></div>
      <div className="project-switcher"><label className="sr-only" htmlFor="project-switch">当前项目</label><FontAwesomeIcon icon={faFilm} />
        <SelectField id="project-switch" disabled={data.projects.length === 0} value={project?.id ?? ''} onChange={(event) => navigate(() => { ui.selectProject(event.target.value); setGroupFilter('all'); setSearch(''); setSelectedDrafts([]); setActiveTask(null); setGroupDialog(null) })}>
          {!data.projects.length && <SelectOption value="">暂无项目</SelectOption>}{data.projects.map((item) => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}</SelectField></div>
      <div className="primary-navigation">
        <Button data-guide-target="video" variant="unstyled" title="视频生成" aria-label="视频生成" className={`nav-item ${ui.view === 'video' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('video'))}><FontAwesomeIcon icon={faVideo} /><span>视频生成</span></Button>
        <Button variant="unstyled" title="排片剪辑库" aria-label="排片剪辑库" className={`nav-item ${ui.view === 'assembly' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('assembly'))}><FontAwesomeIcon icon={faClapperboard} /><span>排片剪辑库</span></Button>
        <Button data-guide-target="image-generation" variant="unstyled" title="素材生成" aria-label="素材生成" className={`nav-item ${ui.view === 'image-generation' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('image-generation'))}><FontAwesomeIcon icon={faImage} /><span>素材生成</span></Button>
        <Button data-guide-target="assets" variant="unstyled" title="素材库" aria-label="素材库" className={`nav-item ${ui.view === 'assets' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('assets'))}><FontAwesomeIcon icon={faImages} /><span>素材库</span></Button>
        <Button variant="unstyled" title="剧本库" aria-label="剧本库" className={`nav-item ${ui.view === 'script-library' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('script-library'))}><FontAwesomeIcon icon={faBookOpen} /><span>剧本库</span></Button>
        {(extensions.data ?? []).filter((extension) => extension.enabled).flatMap((extension) => (extension.manifest.contributes.pages ?? []).map((page) =>
          <Button variant="unstyled" key={`${extension.id}/${page.id}`} title={`${extension.manifest.displayName} · ${page.title}`} className={`nav-item ${ui.view === 'extension-page' && extensionSelection?.pageId === page.id ? 'active' : ''}`} onClick={() => navigate(() => { setExtensionSelection({ extensionId: extension.id, pageId: page.id }); ui.setView('extension-page') })}><FontAwesomeIcon icon={faPuzzlePiece} /><span>{page.title}</span></Button>))}
      </div>
      <div className="sidebar-bottom">
        <Button data-guide-target="tasks" variant="unstyled" title="任务队列" aria-label="任务队列" className={`nav-item ${ui.view === 'tasks' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('tasks'))}><FontAwesomeIcon icon={faListCheck} /><span>任务队列</span><span className="nav-count">{previews.data ? allTasks.length : '未读取'}</span></Button>
        <Button data-guide-target="workflows" variant="unstyled" title="工作流总览" aria-label="工作流总览" className={`nav-item ${ui.view === 'workflows' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('workflows'))}><FontAwesomeIcon icon={faDiagramProject} /><span>工作流总览</span></Button>
        <Button data-guide-target="accounts" variant="unstyled" title="账号池" aria-label="账号池" className={`nav-item ${ui.view === 'accounts' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('accounts'))}><FontAwesomeIcon icon={faUsers} /><span>账号池</span></Button>
        <Button data-guide-target="mcp" variant="unstyled" title="MCP" aria-label="MCP" className={`nav-item ${ui.view === 'mcp' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('mcp'))}><FontAwesomeIcon icon={faPlug} /><span>MCP</span></Button>
        <Button variant="unstyled" title="Skill" aria-label="Skill" className={`nav-item ${ui.view === 'skills' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('skills'))}><FontAwesomeIcon icon={faBookOpen} /><span>Skill</span></Button>
        <Button variant="unstyled" title="设置" aria-label="设置" className={`nav-item ${ui.view === 'settings' ? 'active' : ''}`} onClick={() => navigate(() => ui.setView('settings'))}><FontAwesomeIcon icon={faGear} /><span>设置</span></Button>
      </div></div><PoolStatus onNotice={setNotice} /><div className="local-status"><span className="ready-dot" /><span>SQLite · 本地存储</span></div>
    </aside>
    <main className="workspace-content">{ui.view !== 'image-generation' && workspaceHeader}
      {assemblyProjects.filter((id) => id === null || data.projects.some((item) => item.id === id)).map((id) => {
        const active = ui.view === 'assembly' && id === (project?.id ?? null)
        return <RetainedAssemblyPage key={id ?? 'public'} projectId={id} active={active} onDirty={onAssemblyDirty} onNotice={setNotice} />
      })}
      {ui.view === 'accounts' ? <AccountsPanel key={`accounts-${editorVersion}`} onDirty={onDirty} onNotice={setNotice} renderWorkflows={(account, onWorkflowDirty) => <WorkflowsPanel accountId={account.id} onDirty={onWorkflowDirty} onNotice={setNotice} />} />
        : ui.view === 'workflows' ? <WorkflowsPanel key={`workflows-${editorVersion}`} onDirty={onDirty} onNotice={setNotice} />
          : ui.view === 'assets' ? <LibraryPanel key={`assets-${project?.id ?? 'all'}-${editorVersion}`} projectId={project?.id ?? null} projects={data.projects} onDirty={onDirty} onNotice={setNotice} />
            : ui.view === 'image-generation' ? <ImageGenerationLibrary key={`images-${project?.id ?? 'public'}-${editorVersion}`} projectId={project?.id ?? null} workspaceHeader={workspaceHeader} onDirty={onDirty} onNotice={setNotice} registerSave={registerImageSave} />
            : ui.view === 'assembly' ? null
            : ui.view === 'script-library' ? <ScriptLibrary key={`library-${project?.id ?? 'unassigned'}-${editorVersion}`} projectId={project?.id ?? null} onDirty={onDirty} onNotice={setNotice} />
            : ui.view === 'settings' ? <SettingsPanel key={`settings-${editorVersion}`} onDirty={onDirty} onNotice={setNotice} onOpenGuide={() => setGuideOpen(true)} />
            : ui.view === 'skills' ? <SkillsPanel onNotice={setNotice} />
            : ui.view === 'extension-page' ? <ExtensionPage key={`${extensionSelection?.extensionId}-${extensionSelection?.pageId}-${project?.id ?? 'public'}-${editorVersion}`} extension={selectedExtension} pageId={extensionSelection?.pageId ?? null} projectId={project?.id ?? null} onDirty={onDirty} onNotice={setNotice} />
            : ui.view === 'extensions' ? <ExtensionsPanel key={editorVersion} onDirty={onDirty} onNotice={setNotice} />
            : ui.view === 'mcp' ? <AssetMcpPanel key={project?.id ?? 'all'} projectId={project?.id ?? null} projects={data.projects} onNotice={setNotice} />
              : ui.view === 'tasks' ? <div className="task-queue-page"><WorkbenchTasks tasks={allTasks} projects={data.projects} loading={previews.isFetching} error={previews.error?.message} onReload={() => void previews.refetch()}
                onSelect={selectTask} onDisconnect={previews.disconnect} onNotice={setNotice} /></div>
              : !project ? <div className="empty-workspace"><FontAwesomeIcon icon={faFilm} /><h2>暂无项目</h2><Button onClick={() => ui.setDialog('project')}><FontAwesomeIcon icon={faPlus} />新建项目</Button></div>
                : <div className="production-area">
                    <section className="shot-list"><div className="pane-toolbar"><h2>视频草稿<span className="count-badge">{project.videoDrafts.length}</span></h2><Button variant="ghost" size="icon" title="新建视频" aria-label="新建视频" onClick={newDraft}><FontAwesomeIcon icon={faPlus} /></Button></div>
                      <div className="draft-group-controls"><label htmlFor="draft-group">分类</label><div className="draft-group-toolbar">
                        <SelectField id="draft-group" value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); setSearch(''); setSelectedDrafts([]) }}>
                          <SelectOption value="all">全部（{project.videoDrafts.length}）</SelectOption><SelectOption value="ungrouped">未分组（{project.videoDrafts.filter((item) => !item.groupId).length}）</SelectOption>
                          {groups.map((group) => <SelectOption key={group.id} value={group.id}>{group.name}（{project.videoDrafts.filter((item) => item.groupId === group.id).length}）</SelectOption>)}
                        </SelectField>
                        <Button variant="ghost" size="icon" title="管理分组" aria-label="管理分组" disabled={busy || dirty} onClick={() => setManagingGroups(true)}><FontAwesomeIcon icon={faGear} /></Button>
                      </div></div>
                      <div className="shot-search"><Input aria-label="搜索草稿标题或简介" placeholder="搜索标题或简介" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedDrafts([]) }} /></div>
                      {selectedDrafts.length > 0 && <div className="draft-selection-controls">
                        <div className="draft-selection-toolbar">
                          <label className="draft-select-all"><input type="checkbox" checked={allVisibleSelected} ref={(input) => { if (input) input.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected }} disabled={busy || !visibleDrafts.length}
                            onChange={(event) => setSelectedDrafts(event.target.checked ? visibleDrafts.map((item) => item.id) : [])} />全选</label>
                          <span className="draft-selection-count" role="status">已选 {selectedDrafts.length} 项</span>
                          <Button variant="ghost" size="small" disabled={busy} onClick={() => setSelectedDrafts([])}>取消选择</Button>
                        </div>
                        <SelectField aria-label="批量移动到分集分组" value="" disabled={busy || dirty} onChange={(event) => { if (event.target.value) void moveDrafts(event.target.value) }}>
                          <SelectOption value="">移动到分组…</SelectOption><SelectOption value="ungrouped">未分组</SelectOption>{groups.map((group) => <SelectOption key={group.id} value={group.id}>{group.name}</SelectOption>)}
                        </SelectField>
                      </div>}
                      <VideoDraftList key={project.id} drafts={visibleDrafts} activeId={savedDraft?.id} selectedIds={selectedDrafts} busy={busy}
                        editable={!busy && !dirty && !workspace.hasExternalChanges} sortable={!busy && !dirty && !workspace.hasExternalChanges && !search.trim()}
                        emptyMessage={search.trim() ? '没有匹配的草稿' : '当前分类暂无已保存草稿'}
                        onSelect={(id) => { void navigate(() => { ui.selectDraft(id); setActiveTask(null) }) }}
                        onToggleSelection={(id) => setSelectedDrafts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
                        onSelectAll={() => { if (!busy) setSelectedDrafts(visibleDrafts.map((item) => item.id)) }}
                        onCopy={(id) => { void copyDraft(id) }} onRemove={(item) => { void removeEntity('video', item.id, item.title) }} onReorder={(ids) => { void reorderDrafts(ids) }} />
                    </section>
                    {draft && <><VideoInspector key={`${draft.id}-${editorVersion}`} draft={draft} projectId={project.id} saved={Boolean(savedDraft)} saving={busy} externalChanges={workspace.hasExternalChanges} onSave={saveVideo} onDirty={onDirty} onNotice={setNotice} onSubmitted={setActiveTask} initialTab="video" />
                      <PreviewPanel title={draft.title} preview={preview} predecessor={tasks.find((task) => task.id === preview?.continuitySourceJobId)} records={draftTasks} selectedRecord={activeTask} onSelectRecord={setActiveTask} onNotice={setNotice} /></>}
                  </div>}
      <footer className="workspace-footer"><span className="footer-project" title={project?.name}>{project?.name ?? '未选择项目'}</span>
        <PopoverTrigger asChild><Button variant="unstyled" className="footer-queue-toggle" title="查看本地任务队列" aria-haspopup="dialog" aria-controls="task-queue-popover" aria-expanded={ui.queueOpen}>
          <FontAwesomeIcon icon={faListCheck} /><span>任务队列</span><span className="footer-task-counts">{previews.error ? '读取失败' : !previews.data ? '未读取' : `运行 ${queueCounts.running} · 排队 ${queueCounts.queued}`}</span><FontAwesomeIcon icon={faChevronDown} rotation={ui.queueOpen ? undefined : 180} /></Button></PopoverTrigger></footer>
    </main>
    <TaskQueuePopover><WorkbenchTasks tasks={allTasks} projects={data.projects} loading={previews.isFetching} error={previews.error?.message} onReload={() => void previews.refetch()}
      onSelect={selectTask} onDisconnect={previews.disconnect} onNotice={setNotice} actions={<>
        <Button variant="ghost" size="icon" title="打开完整任务队列" aria-label="打开完整任务队列" onClick={() => navigate(() => ui.setView('tasks'))}><FontAwesomeIcon icon={faListCheck} /></Button>
        <Button variant="ghost" size="icon" title="关闭任务浮窗" aria-label="关闭任务浮窗" onClick={() => ui.setQueueOpen(false)}><FontAwesomeIcon icon={faXmark} /></Button></>} /></TaskQueuePopover>
    <FirstUseGuide autoStart={!detached} requested={guideOpen} onClose={() => setGuideOpen(false)} onNavigate={navigateGuide} activeView={ui.view} />
    {notice.message && <div key={notice.revision} className="toast" role="status"><span>{notice.message}</span><Button variant="ghost" size="icon" title="关闭通知" aria-label="关闭通知" onClick={() => setNotice('')}><FontAwesomeIcon icon={faXmark} /></Button></div>}
    {ui.dialog === 'project' && <NameDialog title="新建项目" onClose={() => ui.setDialog(null)} onCreate={createEntity} />}
    {managingGroups && !groupDialog && <Dialog title="管理分组" onClose={() => { if (!busy) setManagingGroups(false) }}>
      <div className="pane-toolbar"><span>{groups.length} 个分组</span><Button disabled={busy || dirty} onClick={() => setGroupDialog({ name: '' })}><FontAwesomeIcon icon={faPlus} />新建分组</Button></div>
      <div className="group-manager-list">{groups.map((group) => <div className="pane-toolbar" key={group.id}>
        <span className="group-manager-name" title={group.name}>{group.name}（{project?.videoDrafts.filter((item) => item.groupId === group.id).length ?? 0}）</span>
        <div className="button-row"><Button variant="ghost" size="icon" title={`重命名：${group.name}`} aria-label={`重命名：${group.name}`} disabled={busy || dirty} onClick={() => setGroupDialog(group)}><FontAwesomeIcon icon={faPen} /></Button>
          <Button variant="ghost" size="icon" title={`删除分组：${group.name}`} aria-label={`删除分组：${group.name}`} disabled={busy || dirty} onClick={() => void removeGroup(group.id, group.name)}><FontAwesomeIcon icon={faTrash} /></Button></div>
      </div>)}</div>
    </Dialog>}
    {groupDialog && <NameDialog title={groupDialog.id ? '重命名分组' : '新建分组'} initialName={groupDialog.name} submitLabel="保存" onClose={() => setGroupDialog(null)} onCreate={saveGroup} />}
    {renamingProject && <NameDialog title="重命名项目" initialName={renamingProject.name} submitLabel="保存" onClose={() => setRenamingProject(null)} onCreate={async (name) => {
      if (busy || dirty) throw new Error('请先保存当前修改，再重命名项目')
      if (!data.projects.some((item) => item.id === renamingProject.id)) throw new Error('项目已不可用，请重新载入')
      await persist({ ...data, projects: data.projects.map((item) => item.id === renamingProject.id ? { ...item, name } : item) })
    }} />}
  </div></Popover>
}
