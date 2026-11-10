import { z } from 'zod'
import { findCombatSwitches } from './combat-switch'
import type { PreviewCapabilities } from '../../../shared/contracts/preview'

type VideoKind = 'draft' | 'final'

export interface WorkflowPreviewDefinition {
  samplingNodes: string[]
  videoOutputs: { nodeId: string; kind: VideoKind; prefix: string }[]
  capabilities: PreviewCapabilities
}

export const workflowPreviewDefinitionSchema = z.object({
  samplingNodes: z.array(z.string().min(1).max(100)).max(5000),
  videoOutputs: z.array(z.object({ nodeId: z.string().min(1).max(100), kind: z.enum(['draft', 'final']), prefix: z.string().min(1).max(256) })).max(5000),
  capabilities: z.object({ status: z.literal('ready'), sampling: z.boolean(), draft: z.boolean(), final: z.boolean(),
    combat: z.boolean().optional(), unclassifiedOutputs: z.number().int().nonnegative() })
}) satisfies z.ZodType<WorkflowPreviewDefinition>

const responseSchema = z.object({ code: z.number(), data: z.object({ prompt: z.string().min(1).max(2 * 1024 * 1024) }) })
const graphSchema = z.record(z.string().min(1).max(100), z.object({
  class_type: z.string().max(200), inputs: z.record(z.string(), z.unknown())
})).refine((graph) => Object.keys(graph).length <= 5000)

type WorkflowGraph = z.infer<typeof graphSchema>
const nodeLinkSchema = z.tuple([z.string(), z.number().int().nonnegative()])

function linkedNode(graph: WorkflowGraph, value: unknown, slot: number) {
  const link = nodeLinkSchema.safeParse(value)
  return link.success && link.data[1] === slot ? graph[link.data[0]] : undefined
}

function isNativeH3VideoOutput(graph: WorkflowGraph, inputs: WorkflowGraph[string]['inputs']): boolean {
  const video = linkedNode(graph, inputs.video, 0)
  if (video?.class_type !== 'CreateVideo') return false
  const decode = linkedNode(graph, video.inputs.images, 0)
  if (decode?.class_type !== 'VAEDecode') return false
  const sampler = linkedNode(graph, decode.inputs.samples, 0)
  if (sampler?.class_type !== 'SelfLiftH3Sampler') return false
  const reference = linkedNode(graph, sampler.inputs.positive, 0)
  const latent = nodeLinkSchema.safeParse(sampler.inputs.latent_image)
  const positive = nodeLinkSchema.safeParse(sampler.inputs.positive)
  if (reference?.class_type !== 'MiniMaxH3ReferenceToVideo' || !latent.success || !positive.success
    || latent.data[0] !== positive.data[0] || latent.data[1] !== 1) return false
  if (video.inputs.audio !== undefined) {
    const audio = linkedNode(graph, video.inputs.audio, 0)
    if (audio?.class_type !== 'VAEDecodeAudio') return false
    const audioSamples = nodeLinkSchema.safeParse(audio.inputs.samples)
    const videoSamples = nodeLinkSchema.safeParse(decode.inputs.samples)
    if (!audioSamples.success || !videoSamples.success || audioSamples.data[0] !== videoSamples.data[0]
      || audioSamples.data[1] !== videoSamples.data[1]) return false
  }
  return true
}

function prefixPattern(prefix: string): string | null {
  // 只展开日期数字占位符，不执行 ComfyUI 表达式，也不接纳任意正则。
  let valid = true
  const parts = prefix.split(/(%date:[^%]*%)/g).map((part) => {
    if (!part.startsWith('%date:')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const format = part.slice(6, -1)
    if (!format || format.replace(/yyyy|yy|MM|dd|hh|HH|mm|ss|SSS|[-_ .]/g, '')) { valid = false; return '' }
    return format.replace(/yyyy|yy|MM|dd|hh|HH|mm|ss|SSS|[-_ .]/g, (token) =>
      /^[A-Za-z]+$/.test(token) ? `\\d{${token.length}}` : token === '.' ? '\\.' : token)
  })
  const literal = prefix.replace(/%date:[^%]*%/g, '')
  return valid && !/[%$\[\]{}]/.test(literal) ? parts.join('') : null
}

function kindForPrefix(prefix: string): VideoKind | null {
  return /_Minimax_H3_Upscale(?:_|$)/.test(prefix) ? 'final'
    : /_Minimax_H3(?:_|$)/.test(prefix) && !prefix.includes('_Minimax_H3_Upscale') ? 'draft' : null
}

export function restoreWorkflowPreviewDefinition(value: unknown): WorkflowPreviewDefinition {
  const definition = workflowPreviewDefinitionSchema.parse(value)
  // 旧解析器曾将无尾下划线的 Upscale 错存为 draft；只按原快照的明确前缀纠正，不读取当前线上图。
  const videoOutputs = definition.videoOutputs.map((output) => ({ ...output, kind: kindForPrefix(output.prefix) ?? output.kind }))
  return { ...definition, videoOutputs, capabilities: { ...definition.capabilities,
    draft: videoOutputs.some((output) => output.kind === 'draft'), final: videoOutputs.some((output) => output.kind === 'final') } }
}

export function inspectWorkflowPreview(response: unknown): WorkflowPreviewDefinition {
  const envelope = responseSchema.parse(response)
  if (envelope.code !== 0) throw new Error('无法获取线上工作流')
  const graph = graphSchema.parse(JSON.parse(envelope.data.prompt) as unknown)
  const samplingNodes: string[] = []
  const videoOutputs: WorkflowPreviewDefinition['videoOutputs'] = []
  const savedVideoCount = Object.values(graph).filter((node) => node.class_type === 'SaveVideo'
    || node.class_type === 'VHS_VideoCombine' && node.inputs.save_output !== false).length
  let unclassifiedOutputs = 0
  for (const [nodeId, node] of Object.entries(graph)) {
    if (node.class_type === 'ModelPreviewOverrideKJ') samplingNodes.push(nodeId)
    if (node.class_type !== 'SaveVideo' && node.class_type !== 'VHS_VideoCombine' || node.inputs.save_output === false) continue
    const rawPrefix = node.inputs.filename_prefix
    const prefix = typeof rawPrefix === 'string' ? rawPrefix.replaceAll('\\', '/').split('/').at(-1) : undefined
    // 原生 H3 只在唯一保存输出且完整连接已验证时认作成片；多输出保持未分类，不能猜低清角色。
    const nativeFinal = node.class_type === 'SaveVideo' && savedVideoCount === 1 && isNativeH3VideoOutput(graph, node.inputs)
    const kind = prefix ? kindForPrefix(prefix) ?? (nativeFinal ? 'final' : null) : null
    const supportedFormat = node.class_type === 'SaveVideo'
      ? nativeFinal && (node.inputs.format === 'auto' || node.inputs.format === 'mp4')
      : node.inputs.format === 'video/h264-mp4'
    if (!prefix || prefix.length > 256 || prefixPattern(prefix) === null || !kind || !supportedFormat) {
      unclassifiedOutputs += 1
      continue
    }
    videoOutputs.push({ nodeId, kind, prefix })
  }
  return {
    samplingNodes, videoOutputs,
    capabilities: {
      status: 'ready', combat: findCombatSwitches(graph).length === 1, sampling: samplingNodes.length > 0,
      draft: videoOutputs.some((output) => output.kind === 'draft'),
      final: videoOutputs.some((output) => output.kind === 'final'), unclassifiedOutputs
    }
  }
}

export function classifyWorkflowVideo(url: string, definition: WorkflowPreviewDefinition): VideoKind | null {
  let filename: string
  try { filename = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '') }
  catch { return null }
  // 优先最长前缀，避免 final 前缀包含 draft 前缀时把成片认成低清。
  const matches = definition.videoOutputs.filter((output) => {
    const pattern = prefixPattern(output.prefix)
    if (pattern === null || output.kind === 'draft' && /_Minimax_H3_Upscale(?:_|\.)/.test(filename)) return false
    return new RegExp(`^${pattern}${output.prefix.endsWith('_') ? '' : '(?:_|\\.|$)'}`).test(filename)
  })
    .sort((left, right) => right.prefix.length - left.prefix.length)
  const first = matches[0]
  if (!first || matches.some((output) => output.prefix.length === first.prefix.length && output.kind !== first.kind)) return null
  return first.kind
}
