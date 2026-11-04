import type { VideoDraft } from '../../../../shared/contracts/video'
import type { DraftReference, ReferenceKind } from '../../../../shared/contracts/references'
import type { PreviewSnapshot } from '../../../../shared/contracts/preview'
import type { TaskConsumption } from '../../../../shared/contracts/consumption'

export class GenerationRejectedError extends Error {}

export interface GenerationRecord {
  id: string
  phase: 'preparing' | 'submitting' | 'accepted' | 'uncertain' | 'rejected'
  createdAt: string
  draft: VideoDraft
  references: DraftReference[]
  preview: PreviewSnapshot
  previewDefinition: string | null
  previewDefinitionRecoveredAt?: string
  replacedTaskIds?: string[]
  regenerationConfirmedAt?: string
  continuityRequest?: { tailSeconds: number }
}

export interface GenerationRepository {
  list(): GenerationRecord[]
  save(record: GenerationRecord): void
}

export interface FinalVideoArchive {
  save(input: { jobId: string; projectId: string; draftId: string; title: string; prompt: string; source: string; submittedAt?: string }, signal: AbortSignal): Promise<string>
  prepareContinuity?(input: { jobId: string; projectId: string; draftId: string; title: string; assetId: string; seconds: number }, signal: AbortSignal, authorize?: () => void): Promise<{
    videoAssetId: string; frameAssetId: string; start: number; end: number
  }>
}

export interface GenerationMedia {
  reference: DraftReference
  path: string
}

export interface GenerationPlan {
  previewDefinition: string
  upload(path: string, kind: ReferenceKind): Promise<string>
  create(media: { reference: DraftReference; filename: string }[]): Promise<string>
}

export interface GenerationGateway {
  queryConsumption?(taskId: string, credential: string): Promise<TaskConsumption>
  inspectPreview(workflowId: string, credential: string): Promise<string>
  prepare(workflowId: string, credential: string, draft: VideoDraft): Promise<GenerationPlan>
}

export interface GenerationContext {
  routes?(): { configId: string; accountId: string; workflowId: string }[]
  draft(projectId: string, draftId: string, expectedRevision: number): Promise<VideoDraft>
  references(draftId: string, projectId: string): GenerationMedia[]
  workflow(id: string): { accountId: string; workflowId: string }
  credential(accountId: string): string
  capacity(accountId: string): Promise<{ limit: number; occupied: number }>
}
