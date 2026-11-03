import type { Episode } from '../../../../shared/contracts/workspace'

export interface ScriptRepository {
  list(projectId: string): Episode[]
  upsert(projectId: string, episode: Episode, order: number): void
}
