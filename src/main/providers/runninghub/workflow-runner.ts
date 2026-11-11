import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import type { StartWorkflowRun } from '../../../shared/contracts/workflow-runs'
import type { Workflow } from '../../../shared/contracts/workflows'
import { WorkflowRejectedError, type WorkflowExecution } from '../../modules/workflows/ports/workflow-runs'
import { inspectWorkflowBindings } from './workflow-form'
import { request } from './generation-gateway'
import { parseWorkflowUsage } from './workflow-usage'

const envelope = z.object({ code: z.number(), data: z.unknown() })
const uploaded = z.object({ fileName: z.string().min(1).max(1000).refine((value) => !value.includes(':') && !value.includes('\\') && !value.startsWith('/') && !value.split('/').includes('..')) })
export class RunningHubWorkflowRunner {
  async prepare(workflow: Workflow, credential: string, values: StartWorkflowRun['values'], media: (id: string, kind: 'image' | 'audio', expectedUpdatedAt: string) => { path: string; assertCurrent: () => void }): Promise<WorkflowExecution> {
    let definition: ReturnType<typeof inspectWorkflowBindings>
    try { definition = inspectWorkflowBindings(await request('/api/openapi/getJsonApiFormat', credential, JSON.stringify({ apiKey: credential, workflowId: workflow.workflowId }), true)) }
    catch { throw new Error('线上输入读取失败，请重新检测工作流') }
    if (JSON.stringify(definition.form.fields) !== JSON.stringify(workflow.form?.fields)) throw new Error('线上输入已变化，请重新检测并填写')
    if (Object.keys(values).some((key) => !definition.form.fields.some((field) => field.key === key))) throw new Error('输入包含未知字段')
    const prepared = definition.form.fields.map((field) => {
      const value = values[field.key]
      const binding = definition.bindings.find((item) => item.key === field.key)!
      if (field.type === 'image' || field.type === 'audio') {
        if (!value || typeof value !== 'object') throw new Error('请选择所有图片或音频参考')
        return { binding, kind: field.type, file: media(value.assetId, field.type, value.expectedUpdatedAt), value: '' }
      }
      const primitive = value ?? field.defaultValue
      if (typeof primitive !== field.type.replace('text', 'string')) throw new Error('输入字段类型不正确')
      return { binding, kind: null, file: null, value: String(primitive) }
    })
    const nodes: { nodeId: string; fieldName: string; fieldValue: string }[] = []
    try {
      for (const input of prepared) {
        let value = input.value
        if (input.file && input.kind) {
          input.file.assertCurrent()
          const path = input.file.path
          const extension = extname(path).toLowerCase()
          if (!(input.kind === 'image' ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.mp3', '.wav', '.flac']).includes(extension)) throw new Error('参考文件格式不受上传接口支持')
          const info = await stat(path)
          if (!info.isFile() || info.size <= 0 || info.size > (input.kind === 'image' ? 10 : 50) * 1024 * 1024) throw new Error('参考文件为空或超过上传上限')
          const body = new FormData(); body.append('file', await openAsBlob(path), `reference${extension}`)
          const response = envelope.parse(await request('/openapi/v2/media/upload/binary', credential, body, false, 120000))
          if (response.code !== 0) throw new Error('参考文件上传失败')
          value = uploaded.parse(response.data).fileName
          input.file.assertCurrent()
        }
        nodes.push({ nodeId: input.binding.nodeId, fieldName: input.binding.field, fieldValue: value })
      }
    } catch { throw new Error('参考素材校验或上传失败，未创建生成任务') }
    return { form: definition.form, async submit(instance) {
      try { for (const input of prepared) input.file?.assertCurrent() }
      catch { throw new WorkflowRejectedError('参考素材已变化，未创建任务') }
      const result = envelope.parse(await request('/task/openapi/create', credential, JSON.stringify({ apiKey: credential, workflowId: workflow.workflowId, nodeInfoList: nodes, instanceType: instance }), true, 60000))
      if (result.code !== 0) {
        if (z.object({ taskId: z.string().min(1) }).safeParse(result.data).success) throw new Error('平台受理状态冲突')
        throw new WorkflowRejectedError(`平台拒绝任务（业务码 ${result.code}），未自动重试`)
      }
      return z.object({ taskId: z.string().regex(/^\d{8,30}$/) }).parse(result.data).taskId
    } }
  }
  async query(taskId: string, credential: string) {
    const result = z.object({ status: z.string(), usage: z.unknown().optional(), results: z.array(z.object({ url: z.string().url(), outputType: z.string() })).nullish() }).parse(await request('/openapi/v2/query', credential, JSON.stringify({ taskId }), true))
    const status = result.status === 'SUCCESS' ? 'success' : ['FAILED', 'FAILURE', 'CANCELED', 'CANCELLED'].includes(result.status) ? 'failed' : ['RUNNING', 'QUEUED', 'PENDING'].includes(result.status) ? 'running' : null
    if (!status) throw new Error('远端状态待核对')
    const outputs = (result.results ?? []).flatMap((item) => {
      const extension = item.outputType.toLowerCase().replace(/^\./, '')
      const kind = ['png', 'jpg', 'jpeg', 'webp'].includes(extension) ? 'image' as const : ['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(extension) ? 'audio' as const : null
      return kind ? [{ url: item.url, extension, kind }] : []
    })
    return { status, outputs, ...parseWorkflowUsage(result.usage) }
  }
}
