import { z } from 'zod'

export const windowClosePromptSchema = z.strictObject({ id: z.string().uuid(), exiting: z.boolean() })
export const windowCloseDecisionSchema = z.strictObject({ id: z.string().uuid(), confirmed: z.boolean() })
export type WindowClosePrompt = z.infer<typeof windowClosePromptSchema>
export type WindowCloseDecision = z.infer<typeof windowCloseDecisionSchema>
