import type { VideoDraft } from '../../../../shared/contracts/video'

export interface VideoDraftRepository {
  list(projectId: string): VideoDraft[]
  upsert(projectId: string, draft: VideoDraft, order: number): void
}
