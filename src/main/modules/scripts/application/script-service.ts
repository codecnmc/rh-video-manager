import type { Episode } from '../../../../shared/contracts/workspace'
import type { ScriptRepository } from '../ports/script-repository'

export class ScriptService {
  constructor(private readonly repository: ScriptRepository) {}

  list(projectId: string): Episode[] { return this.repository.list(projectId) }
  save(projectId: string, episode: Episode, order: number): void { this.repository.upsert(projectId, episode, order) }
}
