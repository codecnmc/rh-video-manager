import { z } from 'zod'

const id = z.string().uuid()
export const defaultImageSize = '2048x1152' as const
export const imageSizeSchema = z.enum(['1024x1024', '1280x720', '720x1280', '1280x800', '2048x2048', '2048x1152', '1152x2048', '2560x1600', '2880x2880', '3840x2160', '2160x3840', '3584x2240'])
export const imageAccountFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(500).refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
  }, '请输入不含 /v1 或路径的 HTTPS 服务地址'),
  model: z.string().trim().min(1).max(150).refine((value) => value.toLowerCase() !== 'auto'),
  protocol: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  accountGroup: z.string().trim().min(1).max(80), maxConcurrency: z.number().int().min(1).max(16),
  enabled: z.boolean()
})
export const imageAccountSchema = imageAccountFieldsSchema.extend({ id, revision: z.number().int().positive(), stopped: z.boolean() })
export const saveImageAccountSchema = imageAccountFieldsSchema.extend({
  id: id.nullable(), expectedRevision: z.number().int().nonnegative(), apiKey: z.string().max(2000).optional()
})
export const imageReferenceSchema = z.object({ assetId: id, expectedUpdatedAt: z.string().datetime() })
export const imageNodeFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120), prompt: z.string().trim().max(50000), size: imageSizeSchema,
  accountId: id.nullable(), references: z.array(imageReferenceSchema).max(16)
})
export const createImageBoardSchema = z.strictObject({ id, projectId: id.nullable(), title: z.string().trim().min(1).max(120) })
export const imageBoardSchema = createImageBoardSchema.extend({
  revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
  hiddenNodeIds: z.array(z.string().max(150)).max(10000).default([]),
  positions: z.record(z.string().max(150), z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }))
})
export const createImageNodeSchema = imageNodeFieldsSchema.extend({ id, boardId: id, sourceNodeId: id.optional(), size: imageSizeSchema.default(defaultImageSize) }).strict()
export const saveImageNodeSchema = imageNodeFieldsSchema.extend({ id, expectedRevision: z.number().int().positive() }).strict()
export const imageTaskStatusSchema = z.enum(['draft', 'queued', 'preparing', 'generating', 'downloading', 'saved', 'not_submitted', 'acceptance_unknown', 'output_unavailable', 'resolved'])
export const imageNodeSchema = createImageNodeSchema.extend({
  deletedAt: z.string().datetime().nullable().optional(),
  automaticAccount: z.boolean().default(false),
  projectId: id.nullable(), revision: z.number().int().positive(), status: imageTaskStatusSchema,
  createdAt: z.string(), updatedAt: z.string(), submittedAt: z.string().nullable(), finishedAt: z.string().nullable().default(null), error: z.string(),
  accountSnapshot: imageAccountFieldsSchema.pick({ name: true, model: true, baseUrl: true, accountGroup: true, protocol: true }).extend({ id }).nullable(),
  assetId: id.nullable(), review: z.enum(['pending', 'approved', 'rejected'])
})
export const imageNodeActionSchema = z.strictObject({ id, expectedRevision: z.number().int().positive() })
export const deleteImageNodesSchema = z.strictObject({ boardId: id, nodes: z.array(imageNodeActionSchema).min(1).max(100) })
export type DeleteImageNodes = z.infer<typeof deleteImageNodesSchema>
export const submitImageNodesSchema = z.strictObject({ nodes: z.array(imageNodeActionSchema).min(1).max(100), confirmed: z.literal(true) })
export const mcpSubmitImageNodesSchema = z.strictObject({ boardId: id, nodes: z.array(imageNodeActionSchema).min(1).max(100), requestKey: z.string().min(1).max(100) })
export type McpSubmitImageNodes = z.infer<typeof mcpSubmitImageNodesSchema>
export const saveImageLayoutSchema = z.strictObject({ id, expectedRevision: z.number().int().positive(), positions: imageBoardSchema.shape.positions,
  hiddenNodeIds: z.array(z.string().max(150)).max(10000).optional() })
export const reviewImageNodeSchema = imageNodeActionSchema.extend({ review: z.enum(['approved', 'rejected']) })
export const imageExecutionSettingsSchema = z.strictObject({ globalConcurrency: z.number().int().min(1).max(64) })
export type ImageExecutionSettings = z.infer<typeof imageExecutionSettingsSchema>
export type ImageAccount = z.infer<typeof imageAccountSchema>
export type SaveImageAccount = z.infer<typeof saveImageAccountSchema>
export type ImageBoard = z.infer<typeof imageBoardSchema>
export type CreateImageBoard = z.infer<typeof createImageBoardSchema>
export type ImageNode = z.infer<typeof imageNodeSchema>
export type CreateImageNode = z.infer<typeof createImageNodeSchema>
export type SaveImageNode = z.infer<typeof saveImageNodeSchema>
export type ImageNodeAction = z.infer<typeof imageNodeActionSchema>
export type SubmitImageNodes = z.infer<typeof submitImageNodesSchema>
export type SaveImageLayout = z.infer<typeof saveImageLayoutSchema>
export type ReviewImageNode = z.infer<typeof reviewImageNodeSchema>

export interface ImageOutputDiagnostics {
  kind: 'inline' | 'url' | 'empty'
  downloadOrigin: string | null
  sameServiceOrigin: boolean
  network: 'not_needed' | 'public' | 'fake_ip' | 'blocked' | 'dns_error'
  fakeIpAllowed: boolean
}
