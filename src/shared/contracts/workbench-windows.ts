import { z } from 'zod'

export const workbenchWindowTargetSchema = z.strictObject({
  projectId: z.string().uuid().nullable(),
  view: z.enum(['video', 'image-generation', 'script-library']),
  boardId: z.string().uuid().nullable(),
  scriptId: z.string().uuid().nullable().optional(),
  scriptUnassigned: z.boolean().optional()
}).refine((target) => target.view === 'image-generation' || target.boardId === null, '仅素材生成窗口可以指定素材画布')
  .refine((target) => target.view === 'script-library' || target.scriptId === undefined && target.scriptUnassigned === undefined, '仅剧本库窗口可以指定剧本位置')

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
