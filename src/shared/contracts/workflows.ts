import { z } from 'zod'
import type { PreviewCapabilities } from './preview'

export const saveWorkflowSchema = z.object({
  id: z.string().uuid().nullable(), name: z.string().trim().min(1).max(100),
  accountId: z.string().uuid(),
  workflowId: z.string().trim().regex(/^\d{8,30}$/, '请输入线上工作流 ID'),
  enabled: z.boolean(), isDefault: z.boolean()
}).refine((value) => !value.isDefault || value.enabled, { path: ['isDefault'], message: '默认工作流必须启用' })
export const inspectWorkflowSchema = z.object({ id: z.string().uuid() })
export type SaveWorkflow = z.infer<typeof saveWorkflowSchema>
export interface Workflow {
  id: string; accountId: string | null; name: string; workflowId: string; enabled: boolean; isDefault: boolean
  capabilities: PreviewCapabilities | null; checkedAt: string | null; error: string
}
