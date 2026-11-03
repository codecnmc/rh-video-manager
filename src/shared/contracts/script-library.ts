import { z } from 'zod'

export const libraryDocumentSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid().nullable(), title: z.string().trim().min(1).max(100),
  markdown: z.string().max(200000), revision: z.number().int().nonnegative(), updatedAt: z.string()
})
export const saveLibraryDocumentSchema = libraryDocumentSchema.pick({ id: true, title: true, markdown: true }).extend({
  projectId: libraryDocumentSchema.shape.projectId.optional(), expectedRevision: z.number().int().nonnegative().nullable()
})
export const deleteLibraryDocumentSchema = z.object({ id: z.string().uuid(), projectId: libraryDocumentSchema.shape.projectId.optional(), expectedRevision: z.number().int().nonnegative() })
export const libraryScopeSchema = z.object({ projectId: libraryDocumentSchema.shape.projectId.default(null) })
export const assignLibraryDocumentSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
export type AssignLibraryDocument = z.infer<typeof assignLibraryDocumentSchema>
export const documentBackupSchema = z.strictObject({
  format: z.literal('video-workbench-script-library'), version: z.literal(1),
  documents: z.array(libraryDocumentSchema.pick({ title: true, markdown: true })).max(1000)
})
export type LibraryDocument = z.infer<typeof libraryDocumentSchema>
export type SaveLibraryDocument = z.infer<typeof saveLibraryDocumentSchema>
export type DeleteLibraryDocument = z.infer<typeof deleteLibraryDocumentSchema>
export type DocumentBackup = z.infer<typeof documentBackupSchema>
