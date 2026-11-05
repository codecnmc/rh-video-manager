import { windowCloseDecisionSchema, type WindowCloseDecision, type WindowClosePrompt } from '../../shared/contracts/window-close'
import type { DesktopHandle } from './handle'

export interface WindowClosePromptHost {
  connect(owner: number): WindowClosePrompt | null
  respond(owner: number, decision: WindowCloseDecision): void
}

export function registerWindowClose(handle: DesktopHandle, prompts: WindowClosePromptHost): void {
  handle('window:close-prompt-current', async (_input, window) => prompts.connect(window.id))
  handle('window:close-prompt-respond', async (input, window) => {
    prompts.respond(window.id, windowCloseDecisionSchema.parse(input))
  })
}
