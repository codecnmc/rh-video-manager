import { z } from 'zod'

// 仅接纳诊断白名单字段，不保存请求体、响应体、签名 URL 或异常原文。
export const taskDiagnosticSchema = z.object({
  id: z.string().uuid(), taskId: z.string().regex(/^\d{0,30}$/),
  event: z.enum(['workflow', 'request', 'request-error', 'query', 'output', 'summary', 'legacy-error']),
  endpoint: z.enum(['query', 'outputs', 'workflow', 'cancel']).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  platformCode: z.number().int().optional(),
  count: z.number().int().nonnegative().optional(),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  role: z.enum(['draft', 'final', 'unclassified']).optional(),
  host: z.string().regex(/^[a-z0-9.-]{1,253}$/).optional(),
  reason: z.enum(['accepted', 'domain-rejected', 'unsupported-type', 'invalid-url', 'network', 'timeout', 'http', 'json', 'oversized', 'schema', 'task-mismatch', 'missing-final', 'complete']).optional(),
  remoteStatus: z.enum(['success', 'failed', 'running', 'queued', 'unknown', 'cancelled']).optional()
})

export type TaskDiagnostic = z.infer<typeof taskDiagnosticSchema>
export const storedTaskDiagnosticSchema = taskDiagnosticSchema.extend({ at: z.string().datetime() })
