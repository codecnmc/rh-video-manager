import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { dialogPreviewSchema, windowCloseDecisionSchema, type WindowCloseDecision, type WindowClosePrompt } from '../../shared/contracts/window-close'
import type { DesktopHandle } from './handle'
import { showLocalDialog } from '../bootstrap/local-dialog'
import { startupFailureDialog } from '../bootstrap/startup-failure-dialog'

export interface WindowClosePromptHost {
  connect(owner: number): WindowClosePrompt | null
  respond(owner: number, decision: WindowCloseDecision): void
  requestPreview(window: BrowserWindow, exiting: boolean): Promise<boolean>
}

export function registerWindowClose(handle: DesktopHandle, prompts: WindowClosePromptHost): void {
  // 正式包不注册调试入口；预览只返回选择结果，不走 app.quit/window.close 或任务操作。
  if (!app.isPackaged) handle('window:preview-dialog', async (input, window) => {
    const kind = dialogPreviewSchema.parse(input)
    if (prompts.connect(window.id)) throw new Error('请先处理当前退出提示')
    if (kind === 'task-exit' || kind === 'task-window') return prompts.requestPreview(window, kind === 'task-exit')
    const options = kind === 'unsaved'
      ? { title: '修改尚未保存', message: '当前内容尚未保存。放弃修改后将关闭此窗口，未保存的内容无法恢复。', cancelLabel: '返回编辑', confirmLabel: '放弃修改并关闭' }
      : kind === 'startup-error'
        ? startupFailureDialog('未能连接本地界面服务。\n\n请重新运行 pnpm dev，再打开工作台。此错误不代表素材目录迁移失败。', true)
        : { title: '仍有生成任务未结束', message: '仍有排队、生成、下载或状态待核对的任务，确定退出软件？\n\n退出会中断本地上传、下载和任务监听。关闭软件不等于取消远端任务，可能已计费；重启后需核对状态，不会自动重新提交生成。', cancelLabel: '继续等待', confirmLabel: '仍然退出' }
    return showLocalDialog({ parent: window, ...options })
  })
  handle('window:close-prompt-current', async (_input, window) => prompts.connect(window.id))
  handle('window:close-prompt-respond', async (input, window) => {
    prompts.respond(window.id, windowCloseDecisionSchema.parse(input))
  })
}
