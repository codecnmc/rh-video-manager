import type { WorkbenchPresence, WorkbenchWindowState } from '@contracts/workbench-windows'

export function windowPeers(current: WorkbenchPresence, state: WorkbenchWindowState) {
  const project = state.windows.filter((window) => window.windowId !== state.owner && window.projectId === current.projectId)
  const document = project.filter((window) => window.view === current.view &&
    (current.view === 'video' ? Boolean(current.draftId) && window.draftId === current.draftId
      : current.view === 'image-generation' ? Boolean(current.boardId) && window.boardId === current.boardId : false))
  return { project, document, editing: document.filter((window) => window.dirty) }
}
