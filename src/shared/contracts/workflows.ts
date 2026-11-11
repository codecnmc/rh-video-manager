import { z } from 'zod'
import type { PreviewCapabilities } from './preview'
export const workflowTemplateSchema = z.enum(['accelerated', 'qwen3-voice-design', 'voxcpm2-voice-clone'])
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>
export const workflowKindSchema = z.enum(['video', 'audio', 'image'])
export type WorkflowKind = z.infer<typeof workflowKindSchema>
export const workflowFieldSchema = z.object({ key: z.string().min(1).max(100), title: z.string().max(300),
  type: z.enum(['text', 'number', 'boolean', 'image', 'audio']), defaultValue: z.union([z.string().max(50000), z.number().finite(), z.boolean()]) })
export const workflowFormSchema = z.object({ fields: z.array(workflowFieldSchema).max(1000), inspectedAt: z.string() })
export type WorkflowFormDefinition = z.infer<typeof workflowFormSchema>

export const workflowApplicationFieldSchema = z.object({ key: z.string().min(1).max(100), label: z.string().trim().min(1).max(150),
  visibility: z.enum(['common', 'advanced', 'fixed']), control: z.enum(['singleline', 'multiline', 'native']),
  defaultValue: z.union([z.string().max(50000), z.number().finite(), z.boolean()]) })
export const workflowApplicationSchema = z.object({ updatedAt: z.string(), needsReview: z.boolean(), fields: z.array(workflowApplicationFieldSchema).max(1000) })
export type WorkflowApplication = z.infer<typeof workflowApplicationSchema>
export const saveWorkflowApplicationSchema = z.object({ id: z.string().uuid(), expectedCheckedAt: z.string(), expectedUpdatedAt: z.string().nullable(),
  fields: z.array(workflowApplicationFieldSchema).max(1000) })
export type SaveWorkflowApplication = z.infer<typeof saveWorkflowApplicationSchema>

export const saveWorkflowSchema = z.object({
  kind: workflowKindSchema.default('video'), id: z.string().uuid().nullable(), name: z.string().trim().min(1).max(100),
  accountId: z.string().uuid(),
  workflowId: z.string().trim().regex(/^\d{8,30}$/, '请输入线上工作流 ID'),
  enabled: z.boolean(), isDefault: z.boolean()
}).refine((value) => !value.isDefault || value.enabled, { path: ['isDefault'], message: '默认工作流必须启用' })
export const inspectWorkflowSchema = z.object({ id: z.string().uuid() })
export type SaveWorkflow = z.input<typeof saveWorkflowSchema>
export interface Workflow {
  id: string; accountId: string | null; name: string; workflowId: string; enabled: boolean; isDefault: boolean
  capabilities: PreviewCapabilities | null; checkedAt: string | null; error: string
  kind?: WorkflowKind
  form?: WorkflowFormDefinition | null
  application?: WorkflowApplication | null
}
