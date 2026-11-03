import { create } from 'zustand'
import type { VideoDraft } from '@contracts/video'

export type WorkbenchView = 'video' | 'image-generation' | 'assembly' | 'script-library' | 'settings' | 'skills' | 'extension-page' | 'assets' | 'accounts' | 'workflows' | 'mcp' | 'extensions' | 'tasks'
interface WorkbenchUi {
  projectId: string | null
  episodeId: string | null
  draftId: string | null
  creatingDraft: boolean
  view: WorkbenchView
  previewKind: 'sampling' | 'draft' | 'final'
  dialog: 'project' | null
  queueOpen: boolean
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  selectProject: (id: string | null) => void
  selectEpisode: (id: string) => void
  selectDraft: (id: string | null) => void
  startDraft: () => void
  setView: (view: WorkbenchView) => void
  setPreviewKind: (kind: WorkbenchUi['previewKind']) => void
  setDialog: (dialog: WorkbenchUi['dialog']) => void
  setQueueOpen: (open: boolean) => void
}

export function resolveSavedDraft(drafts: readonly VideoDraft[], selection: Pick<WorkbenchUi, 'draftId' | 'creatingDraft'>): VideoDraft | undefined {
  // 默认未选中与主动新建必须分开，否则粘贴附件会把隐藏的临时草稿落库。
  if (selection.creatingDraft) return undefined
  return drafts.find((draft) => draft.id === selection.draftId) ?? drafts[0]
}

export const useWorkbenchUi = create<WorkbenchUi>((set) => ({
  projectId: null, episodeId: null, draftId: null, creatingDraft: false, view: 'video', previewKind: 'final', dialog: null, queueOpen: false, sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  selectProject: (id) => set({ projectId: id, episodeId: null, draftId: null, creatingDraft: false, queueOpen: false }),
  selectEpisode: (id) => set({ episodeId: id }),
  selectDraft: (id) => set({ draftId: id, creatingDraft: false }),
  startDraft: () => set({ draftId: null, creatingDraft: true }),
  setView: (view) => set({ view, queueOpen: false }),
  setPreviewKind: (previewKind) => set({ previewKind }),
  setDialog: (dialog) => set({ dialog }),
  setQueueOpen: (queueOpen) => set({ queueOpen })
}))
