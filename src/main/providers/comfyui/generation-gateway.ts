import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { VideoDraft } from '../../../shared/contracts/video'
import type { ComfySource } from '../../../shared/contracts/generation-sources'
import type { GenerationGateway, GenerationPlan } from '../../modules/jobs'
import { GenerationRejectedError } from '../../modules/jobs'
import { prepareH3Graph } from '../runninghub/generation-gateway'
import { ComfyClient, parseComfyGraph } from './client'

export class ComfyGenerationGateway implements GenerationGateway {
  constructor(private readonly source: (id: string) => ComfySource) {}
  async inspectPreview(workflowId: string): Promise<string> {
    const source = this.source(workflowId)
    return JSON.stringify({ address: source.address })
  }
  async prepare(workflowId: string, _credential: string, draft: VideoDraft): Promise<GenerationPlan> {
    const source = this.source(workflowId)
    if (!source.enabled) throw new Error('ComfyUI 来源已停用')
    // 复用纯 H3 图映射，不调用 RH 网络接口；本地同样只接受已适配的全能参考图。
    if (!source.workflow) throw new Error('请先导入视频工作流')
    const prepared = prepareH3Graph({ code: 0, data: { prompt: JSON.stringify(parseComfyGraph(source.workflow)) } }, draft)
    const client = new ComfyClient(source.address)
    const definitions = z.record(z.string(), z.unknown()).parse(await client.request('object_info'))
    const missing = [...new Set(Object.values(prepared.graph).map((node) => node.class_type))].filter((name) => !(name in definitions))
    if (missing.length) throw new Error(`ComfyUI 缺少工作流节点：${missing.join('、')}`)
    const clientId = randomUUID()
    return {
      previewDefinition: JSON.stringify({ address: source.address, clientId,
        preview: JSON.parse(prepared.previewDefinition) as unknown,
        nodes: Object.fromEntries(Object.entries(prepared.graph).map(([id, node]) => [id, node.class_type])) }),
      upload: (path) => client.upload(path),
      async create(media) {
        const kinds = { image: 0, video: 1, audio: 2 }
        const ordered = [...media].sort((a, b) => kinds[a.reference.kind] - kinds[b.reference.kind] || Number(a.reference.label.match(/\d+/)?.[0]) - Number(b.reference.label.match(/\d+/)?.[0]))
        const counters = { image: 0, video: 0, audio: 0 }
        const names = { image: 'Picture', video: 'Video', audio: 'Audio' }
        const remap = new Map(ordered.map(({ reference }) => [reference.label, `<${names[reference.kind]} ${++counters[reference.kind]}>`]))
        const prompt = draft.prompt.replace(/<(Picture|Video|Audio) [1-9]\d*>/g, (label) => remap.get(label) ?? label)
        if (prepared.applyNativeMedia) {
          try { prepared.applyNativeMedia(ordered, prompt) }
          catch { throw new GenerationRejectedError('ComfyUI 全能参考素材映射失败，尚未提交生成') }
        }
        else {
          prepared.graph[prepared.nodeId]!.inputs.prompt = prompt
          prepared.graph[prepared.nodeId]!.inputs.embedded_media_json = JSON.stringify(ordered.map(({ reference, filename }) => ({ filename, media_type: reference.kind, audio_trim: '' })))
        }
        const result = z.object({ prompt_id: z.string().uuid().optional(), error: z.unknown().optional(), node_errors: z.record(z.string(), z.unknown()).optional() }).parse(await client.post('prompt', { prompt: prepared.graph, client_id: clientId }))
        if (result.error || result.node_errors && Object.keys(result.node_errors).length) throw new GenerationRejectedError('ComfyUI 拒绝工作流，请检查节点输入和本地模型')
        if (!result.prompt_id) throw new Error('ComfyUI 未返回任务标识，受理结果待核对')
        return result.prompt_id
      }
    }
  }
}
