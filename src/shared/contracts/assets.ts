import { z } from 'zod'
import { pastedImagesSchema } from './references'

export const assetKindSchema = z.enum(['image', 'video', 'audio', 'prompt'])
export const assetMetadataSchema = z.object({
  name: z.string().trim().min(1).max(150),
  categoryId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  prompt: z.string().max(50000),
  notes: z.string().max(10000)
})
export const assetSchema = assetMetadataSchema.extend({
  id: z.string().uuid(), projectId: z.string().uuid().nullable(), kind: assetKindSchema,
  size: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
  archived: z.boolean(),
  imageGeneration: z.object({ taskId: z.string().uuid(), accountId: z.string().uuid(), accountName: z.string(), model: z.string(),
    accountGroup: z.string().default(''), baseUrl: z.string().default(''), submittedAt: z.string() }).optional()
})
export const categorySchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(60), parentId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null)
})
export const saveCategorySchema = z.object({
  id: z.string().uuid().nullable(), name: categorySchema.shape.name, parentId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional()
})
export const importAssetsSchema = z.object({
  projectId: z.string().uuid().nullable(), categoryId: z.string().uuid().nullable(),
  kind: z.enum(['image', 'video', 'audio']), tags: assetMetadataSchema.shape.tags,
  prompt: assetMetadataSchema.shape.prompt, notes: assetMetadataSchema.shape.notes
})
export const autoImportAssetsSchema = importAssetsSchema.extend({ kind: z.literal('auto') })
export const importAssetFilesSchema = z.object({
  projectId: z.string().uuid().nullable(), categoryId: z.string().uuid().nullable()
})
export const assetMediaExtensions = {
  image: ['png', 'jpg', 'jpeg', 'webp'], video: ['mp4', 'mov', 'webm'], audio: ['mp3', 'wav', 'm4a', 'ogg', 'flac']
}
export const savePromptAssetSchema = assetMetadataSchema.extend({ projectId: z.string().uuid().nullable() })
export const updateAssetSchema = assetMetadataSchema.extend({ id: z.string().uuid(), expectedUpdatedAt: z.string() })
export const replaceAssetFileSchema = z.strictObject({
  id: z.string().uuid(), expectedUpdatedAt: z.string().datetime(), path: z.string().min(1).max(2000)
})
export const resolveAssetPathSchema = z.strictObject({
  assetId: z.string().uuid(), expectedUpdatedAt: z.string().datetime()
})
export interface AssetLocalPath {
  assetId: string
  projectId: string | null
  name: string
  kind: 'image' | 'video' | 'audio'
  updatedAt: string
  size: number
  path: string
}
export const assetFilterSchema = z.object({
  projectId: z.string().uuid().nullable().optional(), categoryId: z.string().uuid().nullable().optional(),
  kind: assetKindSchema.optional(), search: z.string().max(200).optional(), archived: z.boolean().optional()
})
export const attachAssetSchema = z.object({ draftId: z.string().uuid(), assetId: z.string().uuid() })
export const pasteAssetsSchema = z.object({ projectId: z.string().uuid().nullable(), categoryId: z.string().uuid().nullable(), images: pastedImagesSchema })
export const moveAssetsSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  assets: z.array(z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string() })).min(1).max(200)
})
export type PasteAssets = z.infer<typeof pasteAssetsSchema>
export type MoveAssets = z.infer<typeof moveAssetsSchema>
export type Asset = z.infer<typeof assetSchema>
export type AssetCategory = z.infer<typeof categorySchema>
export type AssetFilter = z.infer<typeof assetFilterSchema>
export type ImportAssets = z.infer<typeof importAssetsSchema>
export type AutoImportAssets = z.infer<typeof autoImportAssetsSchema>
export type SavePromptAsset = z.infer<typeof savePromptAssetSchema>
export type UpdateAsset = z.infer<typeof updateAssetSchema>
export type ReplaceAssetFile = z.infer<typeof replaceAssetFileSchema>
export type ResolveAssetPath = z.infer<typeof resolveAssetPathSchema>
export type SaveCategory = z.infer<typeof saveCategorySchema>
