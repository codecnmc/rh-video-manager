import { z } from 'zod'
export const publicVoiceTag = '声音参考音色'

export const createVoiceSchema = z.object({ assetId: z.string().uuid(), expectedUpdatedAt: z.string().min(1), name: z.string().trim().min(1).max(150) })
export type CreateVoice = z.infer<typeof createVoiceSchema>
export const renameVoiceSchema = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().min(1), name: z.string().trim().min(1).max(150) })
export type RenameVoice = z.infer<typeof renameVoiceSchema>
export interface PublicVoice { id: string; name: string; assetId: string; size: number; updatedAt: string; notes: string }
