import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import type { GenerationGateway, GenerationPlan } from '../../modules/jobs'
import { GenerationRejectedError } from '../../modules/jobs'
import type { VideoDraft } from '../../../shared/contracts/video'
import type { ReferenceKind } from '../../../shared/contracts/references'
import { inspectWorkflowPreview } from './workflow-preview'
import { parseTaskConsumption } from './task-consumption'

const nodeSchema = z.object({ class_type: z.string().max(200), inputs: z.record(z.string(), z.unknown()) }).passthrough()
const graphSchema = z.record(z.string().min(1).max(100), nodeSchema).refine((graph) => Object.keys(graph).length <= 5000)
const envelopeSchema = z.object({ code: z.number(), data: z.unknown() })
const linkSchema = z.tuple([z.string(), z.number().int().nonnegative()])
const uploadSchema = z.object({ fileName: z.string().min(1).max(1000).refine((value) =>
  !value.includes('\\') && !value.startsWith('/') && !value.includes(':') && !value.split('/').some((part) => part === '..' || part === '.'), '上传文件路径无效') })
const formats: Record<ReferenceKind, readonly string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.webp'], video: ['.mp4', '.avi', '.mov', '.mkv'], audio: ['.mp3', '.wav', '.flac']
}

async function request(path: string, credential: string, body: NonNullable<RequestInit['body']>, json: boolean, timeout = 20000): Promise<unknown> {
  const response = await fetch(`https://www.runninghub.cn${path}`, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${credential}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body, signal: AbortSignal.timeout(timeout) })
  if (!response.ok || !response.body) throw new Error('RunningHub 请求失败')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('RunningHub 响应过大') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

type Graph = z.infer<typeof graphSchema>

function withoutNotifications(graph: Graph): Graph {
  const notifications = new Set(Object.keys(graph).filter((id) => graph[id]!.class_type === 'Notif-Webhook'))
  for (const node of Object.values(graph)) {
    if (/notif|webhook/i.test(node.class_type) && node.class_type !== 'Notif-Webhook') throw new Error('工作流包含未适配的通知节点，请先在线上移除通知配置')
    for (const [field, value] of Object.entries(node.inputs)) {
      let link = linkSchema.safeParse(value)
      const seen = new Set<string>()
      while (link.success && notifications.has(link.data[0])) {
        const [id, slot] = link.data
        if (seen.has(id) || slot !== 0) throw new Error('通知节点连接无法安全旁路')
        seen.add(id)
        const source = graph[id]!.inputs.any
        node.inputs[field] = source
        link = linkSchema.safeParse(source)
        if (!link.success) throw new Error('通知节点缺少可旁路的上游输入')
      }
    }
  }
  // 仅修改本次内存副本：移除通知输出并旁路透传连接，不改线上模板或用户原文件。
  for (const id of notifications) delete graph[id]
  return graph
}

export function prepareH3Graph(response: unknown, draft: VideoDraft): { graph: Graph; nodeId: string; previewDefinition: string } {
  const envelope = envelopeSchema.parse(response)
  if (envelope.code !== 0) throw new Error('线上工作流读取失败')
  const prompt = z.object({ prompt: z.string().max(2 * 1024 * 1024) }).parse(envelope.data).prompt
  const graph = withoutNotifications(graphSchema.parse(JSON.parse(prompt) as unknown))
  const candidates = Object.entries(graph).filter(([, node]) => node.class_type === 'FeiHouEasyH3RH')
  if (candidates.length !== 1) throw new Error('线上工作流须包含一个受支持的 FeiHouEasyH3RH 全能参考节点')
  const [nodeId, node] = candidates[0]!
  const mode = node.inputs.mode
  if (typeof mode !== 'string' || !['reference', 'reference-to-video', '参考生视频'].includes(mode.toLowerCase())) throw new Error('请将线上 H3 工作流设置为全能参考模式')
  for (const field of ['prompt', 'resolution', 'aspect_ratio', 'reference_mention_mode']) {
    if (typeof node.inputs[field] !== 'string') throw new Error('线上 H3 输入协议不兼容：存在缺失或外部连接的参数')
  }
  if (typeof node.inputs.seconds !== 'number' || typeof node.inputs.prompt_optimizer_enabled !== 'boolean') throw new Error('线上 H3 时长或提示词优化字段类型不兼容')
  if (!['index', 'by index'].includes(String(node.inputs.reference_mention_mode).toLowerCase())) throw new Error('请将线上 H3 引用模式设置为按编号引用')
  if (node.inputs.production_shot || node.inputs.refmods) throw new Error('当前全能参考适配不支持制作包或 RefMod 外部输入')
  for (const [field, value] of Object.entries(node.inputs)) {
    if (/^media_(?:type_|trim_)?\d+$/.test(field)) {
      if (typeof value !== 'string') throw new Error('线上 H3 包含外部媒体连接，不能混用本地参考素材')
      node.inputs[field] = ''
    }
  }
  Object.assign(node.inputs, { prompt: draft.prompt, seconds: draft.duration, resolution: draft.resolution,
    aspect_ratio: draft.aspectRatio, prompt_optimizer_enabled: false, reference_text_only: false })
  if ('audio_duration_auto' in node.inputs) {
    const value = node.inputs.audio_duration_auto
    if (typeof value !== 'boolean' && typeof value !== 'string') throw new Error('线上 H3 自动时长字段不兼容')
    node.inputs.audio_duration_auto = typeof value === 'boolean' ? false : value === 'Off' ? 'Off' : 'off'
  }
  // ComfyUI 原生 ResolutionSelector 的枚举来自上游协议；保持一采/二采画幅一致。
  const ratios = { '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)', '1:1': '1:1 (Square)' }
  for (const candidate of Object.values(graph)) {
    if (candidate.class_type !== 'ResolutionSelector') continue
    if (typeof candidate.inputs.aspect_ratio !== 'string' || typeof candidate.inputs.megapixels !== 'number') throw new Error('线上二采画布参数存在外部连接，当前不能覆盖')
    candidate.inputs.aspect_ratio = ratios[draft.aspectRatio]
    candidate.inputs.megapixels = draft.resolution === '720P' ? 0.9 : 2.0
  }
  const previewDefinition = JSON.stringify(inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify(graph) } }))
  return { graph, nodeId, previewDefinition }
}

export class RunningHubGenerationGateway implements GenerationGateway {
  async queryConsumption(taskId: string, credential: string) {
    try {
      z.string().regex(/^\d{8,30}$/).parse(taskId)
      const response = envelopeSchema.parse(await request('/task/openapi/outputs', credential,
        JSON.stringify({ apiKey: credential, taskId }), true))
      if (response.code !== 0) throw new Error('费用尚不可用')
      return parseTaskConsumption(response.data)
    } catch { throw new Error('费用查询失败，请检查原账号权限或平台结果有效期；兼容接口可能已停用，未重新生成') }
  }

  async inspectPreview(workflowId: string, credential: string): Promise<string> {
    try {
      return JSON.stringify(inspectWorkflowPreview(await request('/api/openapi/getJsonApiFormat', credential,
        JSON.stringify({ apiKey: credential, workflowId }), true)))
    } catch { throw new Error('线上工作流输出角色读取失败，请核对原账号权限和网络；未重新生成') }
  }

  async prepare(workflowId: string, credential: string, draft: VideoDraft): Promise<GenerationPlan> {
    let prepared: ReturnType<typeof prepareH3Graph>
    try {
      prepared = prepareH3Graph(await request('/api/openapi/getJsonApiFormat', credential, JSON.stringify({ apiKey: credential, workflowId }), true), draft)
    } catch (error) {
      if (error instanceof Error && !(error instanceof z.ZodError) && /^(请|线上|工作流|通知|当前)/.test(error.message)) throw error
      throw new Error('线上工作流校验失败，请核对账号权限、H3 节点版本和网络')
    }
    return { previewDefinition: prepared.previewDefinition,
      async upload(path, kind) {
        if (!formats[kind].includes(extname(path).toLowerCase())) throw new Error('参考素材格式不受 RunningHub 上传接口支持')
        try {
          const info = await stat(path)
          const maximum = { image: 10, video: 200, audio: 50 }[kind] * 1024 * 1024
          if (!info.isFile() || !info.size || info.size > maximum) throw new Error('素材大小不受支持')
          const form = new FormData()
          form.append('file', await openAsBlob(path), `reference${extname(path).toLowerCase()}`)
          const envelope = envelopeSchema.parse(await request('/openapi/v2/media/upload/binary', credential, form, false, 120000))
          if (envelope.code !== 0) throw new Error('上传失败')
          return uploadSchema.parse(envelope.data).fileName
        } catch { throw new Error('参考素材上传失败，请检查文件、大小、账号权限和网络；未提交生成') }
      },
      async create(media) {
        const ordered = [...media].sort((left, right) => {
          const kinds = { image: 0, video: 1, audio: 2 }
          return kinds[left.reference.kind] - kinds[right.reference.kind] || Number(left.reference.label.match(/\d+/)?.[0]) - Number(right.reference.label.match(/\d+/)?.[0])
        })
        // H3 按每类素材的数组顺序重新编号；仅改任务副本中的标签，不更改草稿原文。
        const counters = { image: 0, video: 0, audio: 0 }
        const names = { image: 'Picture', video: 'Video', audio: 'Audio' }
        const remap = new Map<string, string>()
        for (const { reference } of ordered) remap.set(reference.label, `<${names[reference.kind]} ${++counters[reference.kind]}>`)
        prepared.graph[prepared.nodeId]!.inputs.prompt = draft.prompt.replace(/<(Picture|Video|Audio) [1-9]\d*>/g, (label) => remap.get(label) ?? label)
        prepared.graph[prepared.nodeId]!.inputs.embedded_media_json = JSON.stringify(ordered.map(({ reference, filename }) => ({
          filename, media_type: reference.kind, audio_trim: ''
        })))
        // 不传 retainSeconds、webhookUrl、个人队列或额外模型请求；不自动重试付费创建。
        const response = envelopeSchema.parse(await request('/task/openapi/create', credential, JSON.stringify({
          apiKey: credential, workflowId, workflow: JSON.stringify(prepared.graph), nodeInfoList: [], instanceType: draft.instance
        }), true, 60000))
        if (response.code !== 0) {
          if (z.object({ taskId: z.string().min(1) }).safeParse(response.data).success) throw new Error('平台受理状态冲突')
          throw new GenerationRejectedError(`平台拒绝创建任务（业务码 ${response.code}），请检查额度、账号权限或工作流输入`)
        }
        return z.object({ taskId: z.string().regex(/^\d{8,30}$/) }).parse(response.data).taskId
      }
    }
  }
}
