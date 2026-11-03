import type { DeleteWorkspaceEntity, Workspace } from '../../shared/contracts/workspace'

export interface WorkspaceRepository {
  read(): Promise<Workspace | null>
  write(workspace: Workspace, copyReferences?: { sourceDraftId: string; targetDraftId: string; projectId: string }): Promise<void>
  remove(input: DeleteWorkspaceEntity): Promise<void>
}
