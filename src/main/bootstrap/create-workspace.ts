import type { Workspace } from '../../shared/contracts/workspace'

export function createWorkspace(): Workspace {
  return { version: 1, revision: 0, updatedAt: new Date().toISOString(), projects: [] }
}
