import { z } from 'zod'

export const windowClosePromptSchema = z.strictObject({ id: z.string().uuid(), exiting: z.boolean(), preview: z.boolean().optional() })
export const dialogPreviewSchema = z.enum(['task-exit', 'task-window', 'fallback-exit', 'unsaved', 'startup-error'])
export type DialogPreview = z.infer<typeof dialogPreviewSchema>
export const windowCloseDecisionSchema = z.strictObject({ id: z.string().uuid(), confirmed: z.boolean() })
export type WindowClosePrompt = z.infer<typeof windowClosePromptSchema>
export type WindowCloseDecision = z.infer<typeof windowCloseDecisionSchema>
