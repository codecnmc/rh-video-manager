import { z } from 'zod'
import { workflowFormSchema, workflowApplicationSchema } from './workflows'

export const comfyAddressSchema = z.string().trim().max(2000).transform((value, context) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error()
    return url.href.replace(/\/$/, '')
  } catch { context.addIssue({ code: 'custom', message: '请输入不含账号、参数或片段的服务地址' }); return z.NEVER }
})
export const comfyWorkflowSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1, '请填写工作流名称').max(100),
  kind: z.enum(['video', 'audio']), purpose: z.enum(['video', 'voice-clone', 'voice-design', 'audio']).optional(),
  enabled: z.boolean(), workflow: z.string().min(2, '请导入工作流 JSON').max(2 * 1024 * 1024, '工作流超过 2MB'),
  form: workflowFormSchema.nullable().optional(), application: workflowApplicationSchema.nullable().optional(),
  checkedAt: z.string().nullable().optional(), error: z.string().optional()
})
export type ComfyWorkflow = z.infer<typeof comfyWorkflowSchema>
export const comfySourceSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1, '请填写连接名称').max(100, '连接名称最多 100 字'), address: comfyAddressSchema,
  enabled: z.boolean(), workflow: z.string().min(2).max(2 * 1024 * 1024).optional(),
  workflows: z.array(comfyWorkflowSchema).max(100).optional()
})
export type ComfySource = z.infer<typeof comfySourceSchema>
export const generationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rh'), workflowConfigId: z.string().uuid().optional() }),
  z.object({ kind: z.literal('comfyui'), sourceId: z.string().uuid(), workflowId: z.string().uuid().optional() })
])
export type GenerationTarget = z.infer<typeof generationTargetSchema>
export const routingSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  sources: z.array(comfySourceSchema).max(30),
  rules: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100), enabled: z.boolean(),
    resolution: z.enum(['all', '480P', '720P', '1080P']), target: generationTargetSchema })).max(100)
})
export type RoutingSettings = z.infer<typeof routingSettingsSchema>
export interface ComfyConnectionResult { http: boolean; websocket: boolean; missingNodes: string[]; message: string }
