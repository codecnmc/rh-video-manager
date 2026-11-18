import { z } from 'zod'

// 仅接纳诊断白名单字段，不保存请求体、响应体、签名 URL 或异常原文。
export const taskDiagnosticSchema = z.object({
  id: z.string().uuid(), taskId: z.union([z.string().regex(/^\d{0,30}$/), z.string().uuid()]),
  event: z.enum(['workflow', 'request', 'request-error', 'query', 'output', 'summary', 'legacy-error', 'socket', 'sampling']),
  endpoint: z.enum(['query', 'outputs', 'workflow', 'cancel']).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  platformCode: z.number().int().optional(),
  count: z.number().int().nonnegative().optional(),
  sourceEvent: z.enum(['progress', 'progress_state', 'kj_preview_override', 'binary']).optional(),
  step: z.number().finite().optional(),
  total: z.number().finite().optional(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'other']).optional(),
  payloadLength: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  audio: z.boolean().optional(),
  binaryType: z.number().int().nonnegative().optional(),
  samplingAvailable: z.boolean().optional(),
  historicalEventsAvailable: z.literal(false).optional(),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  role: z.enum(['sampling', 'draft', 'final', 'unclassified']).optional(),
  host: z.string().regex(/^[a-z0-9.-]{1,253}$/).optional(),
  reason: z.enum(['connecting', 'accepted', 'domain-rejected', 'unsupported-type', 'invalid-url', 'network', 'timeout', 'http', 'json', 'oversized', 'schema', 'task-mismatch', 'missing-final', 'complete', 'missing-socket', 'closed', 'missing-sampling', 'missing-image', 'invalid-image', 'node-mismatch']).optional(),
  remoteStatus: z.enum(['success', 'failed', 'running', 'queued', 'unknown', 'cancelled']).optional()
})

export type TaskDiagnostic = z.infer<typeof taskDiagnosticSchema>
export const storedTaskDiagnosticSchema = taskDiagnosticSchema.extend({ at: z.string().datetime() })
