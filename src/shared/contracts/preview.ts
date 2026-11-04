import { z } from 'zod'
import { taskConsumptionSchema, type TaskConsumption } from './consumption'

export const connectPreviewSchema = z.object({
  taskId: z.string().regex(/^\d{8,30}$/, '请输入 RunningHub 任务 ID'),
  workflowConfigId: z.string().uuid(),
  accountId: z.string().uuid(),
  projectId: z.string().uuid(),
  draftId: z.string().uuid()
})

export type ConnectPreview = z.infer<typeof connectPreviewSchema>
export type PreviewKind = 'sampling' | 'draft' | 'final'
export const previewNotificationTargetSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), draftId: z.string().uuid(),
  kind: z.enum(['sampling', 'draft', 'final']).optional()
})
export type PreviewNotificationTarget = z.infer<typeof previewNotificationTargetSchema>
export type PreviewConnection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'completed'
export type RemoteStatus = 'unknown' | 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export interface PreviewMedia {
  source: string
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4'
  receivedAt: string
}

export interface PreviewCapabilities {
  status: 'checking' | 'ready' | 'failed'
  sampling: boolean | null
  draft: boolean | null
  final: boolean | null
  unclassifiedOutputs: number
}

export const continuityReferenceSchema = z.object({
  status: z.enum(['processing', 'ready', 'failed']), sourceAssetId: z.string().uuid(),
  videoAssetId: z.string().uuid().optional(), frameAssetId: z.string().uuid().optional(),
  start: z.number().finite().nonnegative().optional(), end: z.number().finite().positive().optional(),
  error: z.string().max(1000).optional()
})

export interface PreviewSnapshot {
  id: string
  taskId: string
  workflowId: string
  workflowConfigId: string
  accountId: string
  capabilities: PreviewCapabilities
  projectId: string
  draftId: string
  connection: PreviewConnection
  remoteStatus: RemoteStatus
  submittedAt?: string
  runningObservedAt?: string
  completedAt?: string
  cancelRequestedAt?: string
  localReservationReleasedAt?: string
  manualCancellationConfirmedAt?: string
  executionSeconds?: number
  consumption?: TaskConsumption
  requestedDuration?: number
  continuitySourceJobId?: string
  resultVideos?: PreviewMedia[]
  finalArchive?: { status: 'downloading' | 'ready' | 'failed'; source: string; attempts: number; assetId?: string; error?: string }
  continuityReference?: z.infer<typeof continuityReferenceSchema>
  stage: string
  step: number
  total: number
  samplingStep: number
  samplingTotal: number
  sampling: PreviewMedia | null
  draft: PreviewMedia | null
  final: PreviewMedia | null
  notice: string
  cancelState: 'none' | 'requesting' | 'requested' | 'uncertain' | 'rejected'
}

const previewMediaSchema = z.object({ source: z.string().max(35 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']), receivedAt: z.string().datetime() })
export const previewSnapshotSchema = z.object({
  id: z.string().uuid(), taskId: z.string().max(30), workflowId: z.string().max(100),
  workflowConfigId: z.string().uuid(), accountId: z.string().uuid(), projectId: z.string().uuid(), draftId: z.string().uuid(),
  capabilities: z.object({ status: z.enum(['checking', 'ready', 'failed']), sampling: z.boolean().nullable(),
    draft: z.boolean().nullable(), final: z.boolean().nullable(), unclassifiedOutputs: z.number().int().nonnegative() }),
  connection: z.enum(['connecting', 'connected', 'reconnecting', 'disconnected', 'completed']),
  remoteStatus: z.enum(['unknown', 'queued', 'running', 'success', 'failed', 'cancelled']), stage: z.string().max(1000),
  submittedAt: z.string().datetime().optional(), runningObservedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(), executionSeconds: z.number().finite().nonnegative().optional(),
  consumption: taskConsumptionSchema.optional(),
  cancelRequestedAt: z.string().datetime().optional(),
  localReservationReleasedAt: z.string().datetime().optional(),
  manualCancellationConfirmedAt: z.string().datetime().optional(),
  requestedDuration: z.number().int().min(4).max(15).optional(),
  continuitySourceJobId: z.string().uuid().optional(),
  resultVideos: z.array(previewMediaSchema).max(100).optional(),
  finalArchive: z.object({ status: z.enum(['downloading', 'ready', 'failed']), source: z.string().max(10000),
    attempts: z.number().int().nonnegative(), assetId: z.string().uuid().optional(), error: z.string().max(1000).optional() }).optional(),
  continuityReference: continuityReferenceSchema.optional(),
  step: z.number().nonnegative(), total: z.number().nonnegative(), samplingStep: z.number().nonnegative(), samplingTotal: z.number().nonnegative(),
  sampling: previewMediaSchema.nullable(), draft: previewMediaSchema.nullable(), final: previewMediaSchema.nullable(),
  notice: z.string().max(5000), cancelState: z.enum(['none', 'requesting', 'requested', 'uncertain', 'rejected'])
}) satisfies z.ZodType<PreviewSnapshot>

export type PreviewState = Omit<PreviewSnapshot, 'sampling' | 'draft' | 'final'>

export type PreviewEvent =
  | { type: 'state'; state: PreviewState }
  | { type: 'media'; id: string; kind: PreviewKind; media: PreviewMedia }

export const previewActionSchema = z.object({ id: z.string().uuid() })
export const releaseReservationSchema = z.object({ id: z.string().uuid(), expectedTaskId: z.string().regex(/^\d{8,30}$/), confirmed: z.literal(true) })
export const downloadPreviewSchema = z.object({ id: z.string().uuid(), kind: z.enum(['sampling', 'draft', 'final']) })
export const refreshGenerationResultsSchema = z.object({ id: z.string().uuid(), workflowUnchangedConfirmed: z.boolean() })
export const taskOutputActionSchema = z.object({ id: z.string().uuid(), index: z.number().int().min(0).max(99), action: z.enum(['copy', 'download']) })
