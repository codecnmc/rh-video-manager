import { z } from 'zod'
import { generationTargetSchema } from './generation-sources'

export const submitGenerationSchema = z.object({
  requestId: z.string().uuid(),
  routingRevision: z.number().int().nonnegative().optional(),
  projectId: z.string().uuid(),
  draftId: z.string().uuid(),
  workflowConfigId: z.string().uuid(),
  expectedAccountId: z.string().uuid(),
  expectedWorkflowId: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.literal(true),
  target: generationTargetSchema.optional(),
  replacement: z.object({
    taskIds: z.array(z.string().uuid()).min(1).max(100),
    confirmed: z.literal(true)
  }).optional()
})

export type SubmitGeneration = z.infer<typeof submitGenerationSchema>

export const scheduleGenerationSchema = submitGenerationSchema.omit({ workflowConfigId: true, expectedAccountId: true, expectedWorkflowId: true })
export type ScheduleGeneration = z.infer<typeof scheduleGenerationSchema>
