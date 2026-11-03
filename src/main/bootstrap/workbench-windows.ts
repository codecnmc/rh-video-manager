import type { BrowserWindow } from 'electron'
import type { WorkbenchPresence, WorkbenchWindowPresence, WorkbenchWindowState, WorkbenchWindowTarget } from '../../shared/contracts/workbench-windows'

type WorkspaceWindow = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'destroy'> & {
  once(event: 'closed', listener: () => void): unknown
  webContents: { once(event: 'render-process-gone', listener: () => void): unknown }
}

// 每次打开都创建独立 renderer；不复制主进程服务，也不按项目加编辑锁。
export class WorkbenchWindows {
  private readonly sessions = new Map<number, WorkbenchWindowTarget>()
  private readonly presence = new Map<number, WorkbenchWindowPresence>()
  constructor(private readonly create: (onCreated: (window: WorkspaceWindow) => void) => Promise<unknown>,
    private readonly changed: () => void = () => undefined) {}

  state(owner: number): WorkbenchWindowState {
    return { owner, windows: [...this.presence.values()].map((window) => ({ ...window })) }
  }

  report(owner: number, input: WorkbenchPresence): void {
    const next = { ...input, windowId: owner }
    if (JSON.stringify(this.presence.get(owner)) === JSON.stringify(next)) return
    this.presence.set(owner, next)
    this.changed()
  }

  removePresence(owner: number): void {
    if (this.presence.delete(owner)) this.changed()
  }

  context(owner: number): WorkbenchWindowTarget | null {
    const target = this.sessions.get(owner)
    return target ? { ...target } : null
  }

  async open(target: WorkbenchWindowTarget): Promise<void> {
    const session: { window: WorkspaceWindow | null } = { window: null }
    const context = { ...target }
    try {
      await this.create((window) => {
        session.window = window
        // loadURL 前登记，renderer 的首次 context IPC 才能拿到自己的目标。
        this.sessions.set(window.id, context)
        window.once('closed', () => { this.sessions.delete(window.id); this.removePresence(window.id) })
        window.webContents.once('render-process-gone', () => { if (!window.isDestroyed()) window.destroy() })
      })
    } catch {
      if (session.window) {
        this.sessions.delete(session.window.id)
        if (!session.window.isDestroyed()) session.window.destroy()
      }
      throw new Error('独立工作台窗口打开失败')
    }
  }
}
