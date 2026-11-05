import { create } from 'zustand'

interface ScriptLibraryUi {
  unassignedByProject: Record<string, boolean>
  selectedByScope: Record<string, string | null>
  setUnassigned: (projectId: string | null, unassigned: boolean) => void
  selectDocument: (scope: string | null, id: string | null) => void
}

// 只保留本窗口的浏览位置，不缓存正文或未保存表单，也不写入业务数据库。
export const useScriptLibraryUi = create<ScriptLibraryUi>((set) => ({
  unassignedByProject: {},
  selectedByScope: {},
  setUnassigned: (projectId, unassigned) => set((state) => ({
    unassignedByProject: { ...state.unassignedByProject, [projectId ?? 'unassigned']: unassigned }
  })),
  selectDocument: (scope, id) => set((state) => ({
    selectedByScope: { ...state.selectedByScope, [scope ?? 'unassigned']: id }
  }))
}))
