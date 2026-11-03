import { z } from 'zod'

export const draftReferencesSchema = z.object({ draftId: z.string().uuid() })
export const replaceDraftReferenceSchema = draftReferencesSchema.extend({
  id: z.string().uuid(), expectedAssetId: z.string().uuid(), assetId: z.string().uuid(), expectedUpdatedAt: z.string().datetime()
}).strict()
export type ReplaceDraftReference = z.infer<typeof replaceDraftReferenceSchema>
export const importReferencesSchema = draftReferencesSchema.extend({ kind: z.enum(['image', 'video', 'audio']) })
export const pastedImageMaxBytes = 10 * 1024 * 1024
export const pastedImageSchema = z.object({
  name: z.string().trim().min(1).max(150),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= pastedImageMaxBytes,
    '图片为空或超过 10 MB 上限')
})
export const pastedImagesSchema = z.array(pastedImageSchema).min(1).max(9)
export const pasteReferenceImagesSchema = draftReferencesSchema.extend({ images: pastedImagesSchema })
export type PastedImage = z.infer<typeof pastedImageSchema>
export type ReferenceKind = z.infer<typeof importReferencesSchema>['kind']
export interface DraftReference {
  id: string; draftId: string; assetId: string; kind: ReferenceKind; label: string; name: string; size: number
}
