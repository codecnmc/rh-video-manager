import { z } from 'zod'
import { assemblyCaptionStyleSchema, titleVisualSchema } from './assembly'
import { assemblyTransitionSchema, frameMaskSchema } from './assembly-effects'

export const assemblyEditOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set-transition'), clipId: z.string().uuid(), transition: assemblyTransitionSchema.nullable() }).strict(),
  z.object({ kind: z.literal('set-mask'), clipId: z.string().uuid().nullable(), mask: frameMaskSchema.nullable(), inherit: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('set-caption-style'), style: assemblyCaptionStyleSchema }).strict(),
  z.object({ kind: z.literal('set-title'), clipId: z.string().uuid(), visual: titleVisualSchema }).strict(),
  z.object({ kind: z.literal('insert-title'), position: z.number().finite().min(0).max(86400), duration: z.number().finite().min(0.1).max(86400), visual: titleVisualSchema }).strict(),
  z.object({ kind: z.literal('replace-gap-with-title'), beforeClipId: z.string().uuid(), visual: titleVisualSchema, removeCaptionIds: z.array(z.string().uuid()).max(100) }).strict()
])
export const editAssemblySchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid().nullable(), expectedRevision: z.number().int().positive(),
  versionId: z.string().uuid(), copyAs: z.string().trim().min(1).max(80).optional(),
  operations: z.array(assemblyEditOperationSchema).min(1).max(100)
}).strict()
export type AssemblyEditOperation = z.infer<typeof assemblyEditOperationSchema>
export type EditAssembly = z.infer<typeof editAssemblySchema>
