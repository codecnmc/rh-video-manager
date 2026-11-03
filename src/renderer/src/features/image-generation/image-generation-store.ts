import { create } from 'zustand'

interface ImageGenerationUi {
  boardByProject: Record<string, string | null>
  selectBoard: (projectId: string | null, boardId: string | null) => void
}

// 只记住本次应用会话的画布选择；项目数据仍由 Query 从 SQLite 读取。
export const useImageGenerationUi = create<ImageGenerationUi>((set) => ({
  boardByProject: {},
  selectBoard: (projectId, boardId) => set((state) => ({
    boardByProject: { ...state.boardByProject, [projectId ?? 'public']: boardId }
  }))
}))
