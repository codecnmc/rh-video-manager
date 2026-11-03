import { z } from 'zod'

export const assemblyTransitionKindSchema = z.enum(['dissolve', 'black', 'white', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'iris-open', 'iris-close'])
export type AssemblyTransitionKind = z.infer<typeof assemblyTransitionKindSchema>
export const assemblyTransitionSchema = z.object({
  kind: assemblyTransitionKindSchema, duration: z.number().finite().positive().max(86400)
}).strict()
export const frameMaskSchema = z.object({
  kind: z.enum(['rounded', 'ellipse']), inset: z.number().finite().min(0).max(20),
  radius: z.number().finite().min(0).max(40), feather: z.number().finite().min(0).max(10),
  strength: z.number().finite().min(0).max(1)
}).strict()
export type FrameMask = z.infer<typeof frameMaskSchema>
export const titleSurfaceSchema = z.enum(['plain', 'paper', 'fabric'])
export type TitleSurface = z.infer<typeof titleSurfaceSchema>
