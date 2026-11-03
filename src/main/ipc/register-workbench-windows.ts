import { z } from 'zod'
import { workbenchWindowTargetSchema, workbenchPresenceSchema, type WorkbenchPresence, type WorkbenchWindowContext, type WorkbenchWindowState, type WorkbenchWindowTarget } from '../../shared/contracts/workbench-windows'
import type { BrowserWindow } from 'electron'
import type { WorkspaceService } from '../application/workspace-service'
import type { SettingsService } from '../modules/settings'
import type { ImageGenerationService } from '../modules/image-generation'
import type { DesktopHandle } from './handle'

export interface WorkbenchWindowHost {
  context(owner: number): WorkbenchWindowTarget | null
  open(target: WorkbenchWindowTarget): Promise<void>
  state(owner: number): WorkbenchWindowState
  report(owner: number, input: WorkbenchPresence): void
  removePresence(owner: number): void
}

export function registerWorkbenchWindows(handle: DesktopHandle, workspace: WorkspaceService, settings: SettingsService,
  windows: WorkbenchWindowHost, images?: Pick<ImageGenerationService, 'board'>): void {
  const assertProject = async (projectId: string | null) => {
    if (projectId && !(await workspace.load()).projects.some((project) => project.id === projectId)) throw new Error('项目不存在或已删除')
  }
  const observed = new WeakSet<BrowserWindow>()
  handle('workbench:window-state', async (_input, window) => windows.state(window.id))
  handle('workbench:report-presence', async (input, window) => {
    const presence = workbenchPresenceSchema.parse(input)
    if (!observed.has(window)) {
      observed.add(window)
      window.once('closed', () => windows.removePresence(window.id))
      window.webContents.on('render-process-gone', () => windows.removePresence(window.id))
      window.webContents.on('did-start-loading', () => windows.removePresence(window.id))
    }
    // 占用只表示查看/未保存编辑，不授予写权限，也不代替落库时的修订校验。
    windows.report(window.id, presence)
  })
  handle('workbench:window-context', async (_input, window): Promise<WorkbenchWindowContext> => {
    const context = windows.context(window.id)
    if (context) return { ...context, detached: true }
    const projects = (await workspace.load()).projects
    const remembered = settings.preferences().lastProjectId
    return { detached: false, projectId: projects.find((project) => project.id === remembered)?.id ?? projects[0]?.id ?? null,
      view: 'video', boardId: null }
  })
  handle('workbench:open-window', async (input) => {
    const target = workbenchWindowTargetSchema.parse(input)
    await assertProject(target.projectId)
    if (target.boardId) {
      if (!images || images.board(target.boardId).projectId !== target.projectId) throw new Error('素材画布不属于指定项目')
    }
    await windows.open(target)
  })
  handle('workbench:remember-project', async (input, window) => {
    const { projectId } = z.strictObject({ projectId: z.string().uuid().nullable() }).parse(input)
    // 子窗口的导航只属于自己，不争抢下次主窗口的启动位置。
    if (windows.context(window.id)) return
    await assertProject(projectId)
    settings.save({ lastProjectId: projectId })
  })
}
