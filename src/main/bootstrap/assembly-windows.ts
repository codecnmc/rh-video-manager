import type { BrowserWindow } from 'electron'
import type { AssemblyWindowState, AssemblyWindowTarget } from '../../shared/contracts/assembly'

type EditorWindow = Pick<BrowserWindow, 'id' | 'isMinimized' | 'restore' | 'show' | 'focus' | 'isDestroyed' | 'destroy'> & {
  once(event: 'closed', listener: () => void): unknown
  webContents: { once(event: 'render-process-gone', listener: () => void): unknown }
}

// 锁以项目为范围，生命周期跟随真实窗口；不将启用状态持久化到数据库。
export class AssemblyWindows {
  private readonly sessions = new Map<string | null, { target: AssemblyWindowTarget; window: EditorWindow | null }>()
  constructor(private readonly create: (onCreated: (window: EditorWindow) => void) => Promise<unknown>, private readonly notify: () => void) {}

  state(owner: number): AssemblyWindowState {
    return { context: [...this.sessions.values()].find((session) => session.window?.id === owner)?.target ?? null,
      locks: [...this.sessions.values()].map((session) => session.target) }
  }

  hasProject(projectId: string | null): boolean { return this.sessions.has(projectId) }

  assertEditable(projectId: string | null, owner: number): void {
    const context = this.state(owner).context
    if (context && context.projectId !== projectId) throw new Error('独立剪辑窗口不能编辑其他项目')
    const session = this.sessions.get(projectId)
    if (session && session.window?.id !== owner) throw new Error('此项目已在独立剪辑窗口打开，请在该窗口继续编辑')
  }

  async open(target: AssemblyWindowTarget, owner: number): Promise<void> {
    if (this.state(owner).context) throw new Error('请从主窗口打开独立剪辑窗口')
    const existing = this.sessions.get(target.projectId)
    if (existing) {
      if (!existing.window) throw new Error('独立剪辑窗口正在打开，请稍候')
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.show(); existing.window.focus()
      return
    }
    const session: { target: AssemblyWindowTarget; window: EditorWindow | null } = { target, window: null }
    this.sessions.set(target.projectId, session)
    this.notify()
    try {
      await this.create((window) => {
        session.window = window
        window.once('closed', () => {
          if (this.sessions.get(target.projectId) === session) this.sessions.delete(target.projectId)
          this.notify()
        })
        window.webContents.once('render-process-gone', () => { if (!window.isDestroyed()) window.destroy() })
      })
    } catch {
      if (session.window && !session.window.isDestroyed()) session.window.destroy()
      if (this.sessions.get(target.projectId) === session) this.sessions.delete(target.projectId)
      this.notify()
      throw new Error('独立剪辑窗口打开失败，项目已解除锁定')
    }
  }

}
