import type { VideoDraft } from '../../../../shared/contracts/video'
import type { VideoDraftRepository } from '../ports/video-drafts'

export class VideoService {
  constructor(private readonly repository: VideoDraftRepository) {}
  list(projectId: string): VideoDraft[] { return this.repository.list(projectId) }
  save(projectId: string, draft: VideoDraft, order: number): void { this.repository.upsert(projectId, draft, order) }
}
