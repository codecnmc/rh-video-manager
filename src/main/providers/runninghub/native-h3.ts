import { z } from 'zod'
import type { VideoDraft } from '../../../shared/contracts/video'
import type { DraftReference, ReferenceKind } from '../../../shared/contracts/references'
import { inspectWorkflowPreview } from './workflow-preview'

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; [key: string]: unknown }>
type UploadedMedia = { reference: DraftReference; filename: string }
export type NativeH3MediaBinding = (media: UploadedMedia[], prompt: string) => void
const linkSchema = z.tuple([z.string(), z.number().int().nonnegative()])
const referenceField = /^ref_(?:images\.ref_image_|videos\.ref_video_|audios\.ref_audio_|video_audios\.ref_video_audio_)\d+$/
const slots = {
  image: { group: 'ref_images.ref_image_', type: 'LoadImage', field: 'image', limit: 9 },
  video: { group: 'ref_videos.ref_video_', type: 'VHS_LoadVideo', field: 'video', limit: 3 },
  audio: { group: 'ref_audios.ref_audio_', type: 'LoadAudio', field: 'audio', limit: 3 }
} as const

export function prepareNativeH3Graph(graph: Graph, nodeId: string, draft: VideoDraft): NativeH3MediaBinding {
  const node = graph[nodeId]!
  const width = linkSchema.safeParse(node.inputs.width)
  const height = linkSchema.safeParse(node.inputs.height)
  if (!width.success || !height.success || width.data[0] !== height.data[0] || width.data[1] !== 0 || height.data[1] !== 1) throw new Error('线上原生 H3 画幅须连接同一个 ResolutionSelector')
  const canvas = graph[width.data[0]]
  if (canvas?.class_type !== 'ResolutionSelector' || typeof canvas.inputs.aspect_ratio !== 'string'
    || typeof canvas.inputs.megapixels !== 'number' || canvas.inputs.multiple !== 32) throw new Error('线上原生 H3 画幅协议不兼容，请保留 32 像素对齐的分辨率选择器')
  for (const [field, expected] of [['clip', 'CLIPLoader'], ['vae', 'VAELoader'], ['audio_vae', 'VAELoader']] as const) {
    const link = linkSchema.safeParse(node.inputs[field])
    if (!link.success || link.data[1] !== 0 || graph[link.data[0]]?.class_type !== expected) throw new Error('线上原生 H3 编码器或 VAE 连接不兼容')
  }
  const preview = inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify(graph) } })
  if (preview.videoOutputs.length !== 1 || preview.videoOutputs[0]?.kind !== 'final' || preview.capabilities.unclassifiedOutputs !== 0) throw new Error('线上原生 H3 须包含唯一且可识别的 SelfLift 采样成片输出')
  const output = graph[preview.videoOutputs[0].nodeId]!
  if (output.class_type !== 'SaveVideo') throw new Error('当前原生 H3 仅支持 CreateVideo 与 SaveVideo 成片链路')
  const videoLink = linkSchema.parse(output.inputs.video)
  if (graph[videoLink[0]]?.inputs.fps !== 24) throw new Error('线上原生 H3 成片帧率须为 24 fps，不能直接套用其他帧率')
  const video = graph[videoLink[0]]!
  // 旧画布导出的 none 不是服务端合法枚举；仅此旧值按上游默认 auto 兼容，codec 的 none 则合法，不能替换。
  if (video.inputs.chroma_subsampling === 'none') video.inputs.chroma_subsampling = 'auto'
  const chroma = video.inputs.chroma_subsampling
  if (chroma !== undefined && (typeof chroma !== 'string' || !['auto', '444', '422', '420'].includes(chroma))) throw new Error('线上 CreateVideo 色度采样参数无效，请选择 auto、444、422 或 420')
  if (!['match', 'max'].includes(String(node.inputs.ref_image_size))) throw new Error('线上原生 H3 参考图尺寸模式不兼容')

  const templates: Partial<Record<ReferenceKind, Graph[string]>> = {}
  const oldLoaders = new Set<string>()
  for (const [field, value] of Object.entries(node.inputs)) {
    if (!referenceField.test(field)) {
      if (/^ref_(images|videos|audios|video_audios)(?:\.|$)/.test(field)) throw new Error('线上原生 H3 包含未适配的参考槽位')
      continue
    }
    // 视频原声会占用 Audio 编号，不能与独立音频静默混用。
    if (field.startsWith('ref_video_audios.')) throw new Error('当前原生 H3 请将参考视频原声作为独立音频绑定，移除配对原声连接后再提交')
    const kind = (Object.keys(slots) as ReferenceKind[]).find((item) => field.startsWith(slots[item].group))
    const link = linkSchema.safeParse(value)
    const loader = link.success ? graph[link.data[0]] : undefined
    if (!kind || !link.success || link.data[1] !== 0 || loader?.class_type !== slots[kind].type || typeof loader.inputs[slots[kind].field] !== 'string') throw new Error('线上原生 H3 参考槽位须直接连接受支持的上传加载节点')
    templates[kind] ??= structuredClone(loader)
    oldLoaders.add(link.data[0])
    delete node.inputs[field]
  }
  // 未绑定槽位直接移除，不能发送 example.png、空视频或 None 音频作为用户参考。
  for (const id of oldLoaders) {
    const used = Object.values(graph).some((candidate) => Object.values(candidate.inputs).some((value) => {
      const link = linkSchema.safeParse(value)
      return link.success && link.data[0] === id
    }))
    if (!used) delete graph[id]
  }
  const ratios = { '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)', '1:1': '1:1 (Square)' }
  canvas.inputs.aspect_ratio = ratios[draft.aspectRatio]
  canvas.inputs.megapixels = draft.resolution === '720P' ? 0.9 : 2.0
  node.inputs.prompt = draft.prompt
  // 原生 H3 使用 24 fps 与 17n+5 帧格点；直接写入数值，不执行模板数学表达式。
  node.inputs.length = Math.ceil((draft.duration * 24 - 5) / 17) * 17 + 5
  const created = new Set<string>()
  return (media, prompt) => {
    const counts = { image: 0, video: 0, audio: 0 }
    for (const item of media) {
      const kind = item.reference.kind
      if (!templates[kind] || ++counts[kind] > slots[kind].limit) throw new Error(`当前原生 H3 工作流缺少可用的${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}槽位或超出数量上限`)
    }
    for (const field of Object.keys(node.inputs)) if (referenceField.test(field)) delete node.inputs[field]
    for (const id of created) delete graph[id]
    created.clear()
    const indices = { image: 0, video: 0, audio: 0 }
    let nextId = 1
    for (const { reference, filename } of media) {
      const kind = reference.kind
      const loader = structuredClone(templates[kind]!)
      loader.inputs[slots[kind].field] = filename
      if (kind === 'video') {
        // H3 按 24 fps 解释参考帧，去掉模板中的截取设置，完整使用已确认上传的受管参考。
        Object.assign(loader.inputs, { force_rate: 24, force_size: 'Disabled', frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 })
      }
      while (graph[String(nextId)]) nextId++
      const id = String(nextId++)
      graph[id] = loader; created.add(id)
      node.inputs[`${slots[kind].group}${indices[kind]++}`] = [id, 0]
    }
    node.inputs.prompt = prompt
  }
}
