import { z } from 'zod'
import type { PreviewKind, PreviewMedia } from '../../../shared/contracts/preview'
import type { WorkflowPreviewDefinition } from './workflow-preview'

const kjSchema = z.object({
  node_id: z.union([z.string(), z.number()]).transform(String),
  step: z.number().int().min(0).max(100000),
  total: z.number().int().min(0).max(100000),
  image: z.string().max(24 * 1024 * 1024).optional(),
  mime: z.enum(['image/jpeg', 'image/webp', 'video/mp4']).optional()
})

export function allowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (
      url.hostname === 'rh-images.xiaoyaoyou.com' ||
      url.hostname === 'rh-comfyui01.tos-cn-beijing.volces.com' ||
      url.hostname === 'rh-images-1252422369.cos.ap-beijing.myqcloud.com'
    )
  } catch { return false }
}

export function parseSampling(value: unknown, definition: WorkflowPreviewDefinition): { step: number; total: number; media: PreviewMedia | null } | null {
  const parsed = kjSchema.safeParse(value)
  if (!parsed.success || !definition.samplingNodes.includes(parsed.data.node_id)) return null
  const { step, total, image, mime = 'image/jpeg' } = parsed.data
  if (step > total) return null
  if (!image) return { step, total, media: null }
  if (image.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return null
  const bytes = Buffer.from(image, 'base64')
  const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : bytes.toString('ascii', 4, 8) === 'ftyp'
  if (!valid) return null
  return { step, total, media: { source: `data:${mime};base64,${image}`, mime, receivedAt: new Date().toISOString() } }
}

const outputSchema = z.object({
  gifs: z.array(z.object({
    url: z.string().optional(), cos_url: z.string().optional(), fileUrl: z.string().optional()
  }).passthrough()).optional(),
  videos: z.array(z.object({
    url: z.string().optional(), cos_url: z.string().optional(), fileUrl: z.string().optional()
  }).passthrough()).optional()
})

export function parseOutput(node: string, output: unknown, definition: WorkflowPreviewDefinition): { kind: PreviewKind; media: PreviewMedia } | null {
  const kind = definition.videoOutputs.find((candidate) => candidate.nodeId === node)?.kind
  const parsed = outputSchema.safeParse(output)
  if (!kind || !parsed.success) return null
  const candidates = [...(parsed.data.gifs ?? []), ...(parsed.data.videos ?? [])]
  for (const candidate of candidates) {
    const source = candidate.cos_url ?? candidate.url ?? candidate.fileUrl
    if (source && allowedMediaUrl(source)) return { kind, media: { source, mime: 'video/mp4', receivedAt: new Date().toISOString() } }
  }
  return null
}

export function allowedSocketUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'wss:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ['runninghub.cn', 'runninghub.ai'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}
