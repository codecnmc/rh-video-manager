import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { WindowCloseDecision, WindowClosePrompt } from '../../shared/contracts/window-close'

type PromptWindow = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'once' | 'removeListener'> & {
  webContents: Pick<BrowserWindow['webContents'], 'isDestroyed' | 'send' | 'once' | 'removeListener'>
}
interface PendingPrompt {
  prompt: WindowClosePrompt
  promise: Promise<boolean>
  settle: (confirmed: boolean) => void
}

export class WindowClosePrompts {
  private readonly pending = new Map<number, PendingPrompt>()
  private readonly ready = new Set<number>()

  connect(owner: number): WindowClosePrompt | null {
    this.ready.add(owner)
    return this.current(owner)
  }

  isReady(owner: number): boolean { return this.ready.has(owner) }

  disconnect(owner: number): void {
    this.ready.delete(owner)
    this.pending.get(owner)?.settle(false)
  }

  current(owner: number): WindowClosePrompt | null {
    const current = this.pending.get(owner)
    return current ? { ...current.prompt } : null
  }

  request(window: PromptWindow, exiting: boolean): Promise<boolean> {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(false)
    const existing = this.pending.get(window.id)
    if (existing?.prompt.exiting === exiting) return existing.promise
    // 从关闭单窗升级为退出应用时，旧的“后台继续”说明不能授权整个进程退出。
    existing?.settle(false)
    const prompt: WindowClosePrompt = { id: randomUUID(), exiting }
    let resolve: (confirmed: boolean) => void = () => {}
    const promise = new Promise<boolean>((complete) => { resolve = complete })
    const cancel = (): void => settle(false)
    const settle = (confirmed: boolean) => {
      if (this.pending.get(window.id)?.prompt.id !== prompt.id) return
      this.pending.delete(window.id)
      window.removeListener('closed', cancel)
      window.webContents.removeListener('render-process-gone', cancel)
      window.webContents.removeListener('did-start-loading', cancel)
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('window:close-prompt', null)
      } catch { /* 窗口已无法接收消息时仍须撤销请求，不能留下悬挂的退出授权。 */ }
      resolve(confirmed)
    }
    this.pending.set(window.id, { prompt, promise, settle })
    window.once('closed', cancel)
    window.webContents.once('render-process-gone', cancel)
    window.webContents.once('did-start-loading', cancel)
    try { window.webContents.send('window:close-prompt', { ...prompt }) }
    catch { cancel() }
    return promise
  }

  respond(owner: number, decision: WindowCloseDecision): void {
    const current = this.pending.get(owner)
    if (!current || current.prompt.id !== decision.id) throw new Error('退出确认已失效，请重新操作')
    current.settle(decision.confirmed)
  }
}
