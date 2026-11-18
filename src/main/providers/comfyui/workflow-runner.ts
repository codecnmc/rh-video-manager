import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { z } from 'zod'
import type { Workflow } from '../../../shared/contracts/workflows'
import type { StartWorkflowRun, WorkflowRun } from '../../../shared/contracts/workflow-runs'
import { WorkflowRejectedError, type WorkflowExecution } from '../../modules/workflows'
import { inspectWorkflowBindings } from '../runninghub/workflow-form'
import { ComfyClient, parseComfyGraph } from './client'

function bindings(json: string) {
  const graph = parseComfyGraph(json)
  try {
    return { graph, ...inspectWorkflowBindings({ code: 0, data: { prompt: JSON.stringify(graph) } }) }
  } catch {
    throw new Error('工作流字段无法识别，请检查节点标题、输入数量及字段格式')
  }
}

export class ComfyWorkflowRunner {
  async inspect(address: string, json: string, kind: 'video' | 'audio') {
    const definition = bindings(json)
    if (kind === 'video' && Object.values(definition.graph).filter((node) => ['MiniMaxH3ReferenceToVideo', 'FeiHouEasyH3RH'].includes(node.class_type)).length !== 1) throw new Error('此视频入口需要一个受支持的 H3 全能参考节点；声音克隆或音色设计请将用途设为声音类型')
    const nodes = z.record(z.string(), z.unknown()).parse(await new ComfyClient(address).request('object_info'))
    const missing = [...new Set(Object.values(definition.graph).map((node) => node.class_type))].filter((name) => !(name in nodes))
    if (missing.length) throw new Error(`工作流缺少节点：${missing.join('、')}`)
    return kind === 'audio' ? definition.form : null
  }
  async prepare(workflow: Workflow, address: string, json: string, values: StartWorkflowRun['values'], media: (id: string, kind: 'image' | 'audio', expectedUpdatedAt: string) => { path: string; assertCurrent: () => void }): Promise<WorkflowExecution> {
    const definition = bindings(json)
    if (JSON.stringify(definition.form.fields) !== JSON.stringify(workflow.form?.fields)) throw new Error('本地工作流字段已变化，请重新检测')
    await this.inspect(address, json, 'audio')
    const client = new ComfyClient(address)
    const checks: (() => void)[] = []
    for (const field of definition.form.fields) {
      const binding = definition.bindings.find((item) => item.key === field.key)!
      const value = values[field.key] ?? field.defaultValue
      let resolved: string | number | boolean
      if (field.type === 'image' || field.type === 'audio') {
        if (typeof value !== 'object') throw new Error(`请选择素材：${field.title}`)
        const file = media(value.assetId, field.type, value.expectedUpdatedAt)
        file.assertCurrent(); checks.push(file.assertCurrent)
        resolved = await client.upload(file.path)
        file.assertCurrent()
      } else {
        if (typeof value !== field.type.replace('text', 'string') || typeof value === 'object') throw new Error(`输入类型不正确：${field.title}`)
        resolved = value
      }
      definition.graph[binding.nodeId]!.inputs[binding.field] = resolved
    }
    return { form: definition.form, sourceAddress: address, async submit() {
      try { checks.forEach((check) => check()) } catch { throw new WorkflowRejectedError('参考素材已变化，未创建任务') }
      // 仅提交一次，HTTP 中断或缺少回执保留受理不明。
      const result = z.object({ prompt_id: z.string().uuid().optional(), error: z.unknown().optional(), node_errors: z.record(z.string(), z.unknown()).optional() }).parse(await client.post('prompt', { prompt: definition.graph, client_id: randomUUID() }))
      if (result.error || result.node_errors && Object.keys(result.node_errors).length) throw new WorkflowRejectedError('ComfyUI 拒绝工作流，请检查节点输入和模型文件')
      if (!result.prompt_id) throw new Error('未返回任务标识，请到指定 ComfyUI 核对')
      return result.prompt_id
    } }
  }
  async query(run: WorkflowRun) {
    if (!run.sourceAddress) throw new Error('本地任务缺少原连接快照，不能改用其他地址查询')
    const client = new ComfyClient(run.sourceAddress)
    const history = z.record(z.string(), z.object({ outputs: z.record(z.string(), z.unknown()), status: z.object({ completed: z.boolean(), status_str: z.string() }).optional() })).parse(await client.request(`history/${encodeURIComponent(run.taskId)}`))
    const item = history[run.taskId]
    if (!item) {
      const queue = z.object({ queue_running: z.array(z.array(z.unknown())), queue_pending: z.array(z.array(z.unknown())) }).parse(await client.request('queue'))
      if (![...queue.queue_running, ...queue.queue_pending].some((entry) => entry[1] === run.taskId)) throw new Error('原任务在队列和历史中不存在，请核对；不会自动重提')
      return { status: 'running' as const, outputs: [] }
    }
    if (!item.status?.completed && item.status?.status_str !== 'error') return { status: 'running' as const, outputs: [] }
    const fileSchema = z.object({ filename: z.string(), subfolder: z.string().default(''), type: z.enum(['output', 'temp']).default('output') })
    const outputs = Object.values(item.outputs).flatMap((output) => {
      if (!output || typeof output !== 'object') return []
      return Object.values(output).flatMap((entries) => Array.isArray(entries) ? entries.flatMap((entry: unknown) => {
        const file = fileSchema.safeParse(entry)
        if (!file.success) return []
        const extension = extname(file.data.filename).slice(1).toLowerCase()
        const kind = ['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(extension) ? 'audio' as const : ['png', 'jpg', 'jpeg', 'webp'].includes(extension) ? 'image' as const : null
        return kind ? [{ url: `${client.url('view')}?${new URLSearchParams(file.data)}`, kind, extension }] : []
      }) : [])
    })
    return { status: item.status?.status_str === 'success' ? 'success' as const : 'failed' as const, outputs: [...new Map(outputs.map((output) => [output.url, output])).values()] }
  }
}
