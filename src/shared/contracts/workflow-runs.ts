import { z } from 'zod'
import { consumptionAmountSchema } from './consumption'

export const workflowRunValueSchema = z.union([z.string().max(50000), z.number().finite(), z.boolean(), z.object({ assetId: z.string().uuid(), expectedUpdatedAt: z.string().min(1) })])
export const startWorkflowRunSchema = z.object({ requestId: z.string().uuid(), workflowId: z.string().uuid(), expectedCheckedAt: z.string(),
  expectedApplicationUpdatedAt: z.string().nullable().optional(), instance: z.enum(['default', 'plus', 'ultra']), confirmed: z.literal(true), values: z.record(z.string().max(100), workflowRunValueSchema) })
export type StartWorkflowRun = z.infer<typeof startWorkflowRunSchema>
export const workflowRunSchema = z.object({ id: z.string().uuid(), workflowId: z.string().uuid(), workflowName: z.string(),
  accountId: z.string().uuid(), kind: z.enum(['audio', 'image']), taskId: z.string(),
  status: z.enum(['preparing', 'submitting', 'unknown', 'running', 'downloading', 'success', 'failed', 'download-error']),
  createdAt: z.string(), updatedAt: z.string(), message: z.string(),
  hiddenAt: z.string().nullable().optional(), points: consumptionAmountSchema.nullable().optional(), executionSeconds: z.number().finite().nonnegative().nullable().optional(), metricsCheckedAt: z.string().nullable().optional(),
  assets: z.array(z.object({ id: z.string().uuid(), name: z.string(), kind: z.enum(['audio', 'image']) })) })
export type WorkflowRun = z.infer<typeof workflowRunSchema>
