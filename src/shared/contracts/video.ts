import { z } from 'zod'
import { validPromptDocument } from './prompt-document'

export const generationTimingSampleSchema = z.object({
  workflowLabel: z.string().trim().min(1).max(100),
  duration: z.number().int().min(4).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  resolution: z.enum(['720P', '1080P']),
  instance: z.enum(['default', 'plus', 'ultra']),
  images: z.number().int().min(0).max(9),
  videos: z.number().int().min(0).max(3),
  audio: z.number().int().min(0).max(3),
  minSeconds: z.number().int().min(1).max(86400),
  maxSeconds: z.number().int().min(1).max(86400)
}).refine((value) => value.minSeconds <= value.maxSeconds, { path: ['maxSeconds'], message: '最长耗时不能小于最短耗时' })

export type GenerationTimingSample = z.infer<typeof generationTimingSampleSchema>

export const videoDraftSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(20000),
  prompt: z.string().max(50000),
  promptDocument: z.string().max(200000).refine(validPromptDocument, '富文本草稿格式不正确'),
  duration: z.number().int().min(4).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  resolution: z.enum(['720P', '1080P']),
  instance: z.enum(['default', 'plus', 'ultra']),
  instanceMode: z.enum(['auto', 'manual']).default('manual'),
  shotContinuity: z.enum(['independent', 'continuous']).optional(),
  // 描述本段到下一段的出向衔接；旧草稿缺省为切镜，不补做历史素材。
  nextTransition: z.enum(['cut', 'continuous']).optional(),
  continuityTailSeconds: z.number().int().min(1).max(5).optional(),
  timingSamples: z.array(generationTimingSampleSchema).max(20).optional()
})

export type VideoDraft = z.infer<typeof videoDraftSchema>
