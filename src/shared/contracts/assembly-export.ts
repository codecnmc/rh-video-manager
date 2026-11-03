import { z } from 'zod'

export const assemblyExportOptionsSchema = z.object({
  resolution: z.enum(['project', '720p', '1080p', '2160p']),
  frameRate: z.enum(['project', '24', '25', '30', '60']),
  crf: z.number().int().min(14).max(30),
  preset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow']),
  captions: z.enum(['project', 'on', 'off']),
  audioBitrate: z.enum(['128k', '192k', '256k', '320k'])
}).strict()
export type AssemblyExportOptions = z.infer<typeof assemblyExportOptionsSchema>
export const defaultAssemblyExportOptions: AssemblyExportOptions = {
  resolution: 'project', frameRate: 'project', crf: 18, preset: 'fast', captions: 'project', audioBitrate: '192k'
}

export const assemblyExportStageSchema = z.enum(['preparing', 'probing', 'rendering', 'joining', 'mixing', 'captions', 'finalizing', 'completed', 'cancelled', 'failed'])
export const assemblyExportProgressSchema = z.object({
  requestId: z.string().uuid(), stage: assemblyExportStageSchema,
  percent: z.number().finite().min(0).max(100),
  stagePercent: z.number().finite().min(0).max(100).nullable(),
  detail: z.string().max(300), elapsedSeconds: z.number().finite().nonnegative(),
  clipIndex: z.number().int().positive().optional(), clipCount: z.number().int().positive().optional(),
  processedSeconds: z.number().finite().nonnegative().optional(),
  durationSeconds: z.number().finite().nonnegative().optional(), speed: z.number().finite().nonnegative().optional()
})
export type AssemblyExportProgress = z.infer<typeof assemblyExportProgressSchema>
export type AssemblyRenderProgress = Omit<AssemblyExportProgress, 'requestId' | 'elapsedSeconds'>
