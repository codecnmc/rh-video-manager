import { z } from 'zod'

export const workbenchWindowTargetSchema = z.strictObject({
  projectId: z.string().uuid().nullable(),
  view: z.enum(['video', 'image-generation']),
  boardId: z.string().uuid().nullable()
}).refine((target) => target.view === 'image-generation' || target.boardId === null, '视频窗口不能指定素材画布')

export type WorkbenchWindowTarget = z.infer<typeof workbenchWindowTargetSchema>
export type WorkbenchWindowContext = WorkbenchWindowTarget & { detached: boolean }

export const workbenchPresenceSchema = z.strictObject({
  projectId: z.string().uuid().nullable(),
  view: z.enum(['video', 'image-generation', 'other']),
  draftId: z.string().uuid().nullable(),
  boardId: z.string().uuid().nullable(),
  dirty: z.boolean()
}).refine((value) => (value.view === 'video' || value.draftId === null) &&
  (value.view === 'image-generation' || value.boardId === null), '窗口编辑目标不匹配')

export type WorkbenchPresence = z.infer<typeof workbenchPresenceSchema>
export type WorkbenchWindowPresence = WorkbenchPresence & { windowId: number }
export interface WorkbenchWindowState { owner: number; windows: WorkbenchWindowPresence[] }
