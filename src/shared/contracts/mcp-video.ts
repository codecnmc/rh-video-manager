import { z } from 'zod'
import { videoDraftSchema } from './video'

export const mcpDraftScopeSchema = z.object({ projectId: z.string().uuid() })
export const mcpSaveVideoGroupSchema = mcpDraftScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(100)
})
export type McpSaveVideoGroup = z.infer<typeof mcpSaveVideoGroupSchema>
export const mcpSaveDraftSchema = mcpDraftScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  draft: videoDraftSchema.omit({ id: true, promptDocument: true, timingSamples: true }).extend({ id: z.string().uuid().nullable() })
})
export const mcpReferenceScopeSchema = mcpDraftScopeSchema.extend({ draftId: z.string().uuid() })
export type McpSaveDraft = z.infer<typeof mcpSaveDraftSchema>
