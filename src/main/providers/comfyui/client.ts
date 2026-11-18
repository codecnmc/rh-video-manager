import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ComfyConnectionResult } from '../../../shared/contracts/generation-sources'

export const comfyGraphSchema = z.record(z.string().min(1).max(100), z.object({
  class_type: z.string().min(1).max(200), inputs: z.record(z.string(), z.unknown())
}).passthrough()).refine((graph) => Object.keys(graph).length > 0 && Object.keys(graph).length <= 5000, '请导入 API 格式工作流 JSON')
export function parseComfyGraph(value: string) {
  let input: unknown
  try { input = JSON.parse(value) as unknown } catch { throw new Error('工作流不是有效 JSON，请重新导出文件') }
  if (input && typeof input === 'object' && 'nodes' in input && Array.isArray(input.nodes)) throw new Error('导入的是 ComfyUI 画布格式，请在 ComfyUI 中选择“导出 API 格式”后重新导入；普通保存的 JSON 不能直接执行')
  const parsed = comfyGraphSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`API 工作流格式不正确${issue?.path.length ? `：节点/字段 ${issue.path.join('.')}` : '：缺少可执行节点'}；节点需要 class_type 和 inputs`)
  }
  return parsed.data
}

export class ComfyClient {
  constructor(readonly address: string) {}
  url(path: string): string { return `${this.address}/${path.replace(/^\//, '')}` }
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(this.url(path), { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20000) })
    if ((!response.ok && !(path === 'prompt' && response.status === 400)) || !response.body) throw new Error(`ComfyUI 接口返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '，该地址需要授权或登录' : '，请检查服务地址和运行状态'}`)
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 16 * 1024 * 1024) throw new Error('ComfyUI 响应超过上限')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }
  post(path: string, body: unknown) { return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  async removeQueuedTask(taskId: string): Promise<void> {
    z.string().uuid().parse(taskId)
    // 队列删除成功返回空响应，受理后由会话核对原任务是否仍在队列或历史中。
    const response = await fetch(this.url('queue'), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [taskId] }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`ComfyUI 拒绝移除排队任务（HTTP ${response.status}）`)
    await response.body?.cancel()
  }
  async interrupt(taskId: string): Promise<void> {
    z.string().uuid().parse(taskId)
    const stats = z.object({ system: z.object({ comfyui_version: z.string() }) }).parse(await this.request('system_stats'))
    const version = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(stats.system.comfyui_version)
    if (!version || Number(version[1]) === 0 && (Number(version[2]) < 42 || Number(version[2]) === 42 && Number(version[3]) < 5)) {
      throw new Error('此 ComfyUI 版本尚未确认支持按任务终止，请升级至 0.42.5 或更新版本')
    }
    // 已核对 0.42.5 协议：带 prompt_id 仅中断匹配的运行项；绝不降级为空体全局中断。
    const response = await fetch(this.url('interrupt'), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_id: taskId }), signal: AbortSignal.timeout(20000) })
    // 成功为 HTTP 200 空响应，与返回 JSON 的提交接口不同。
    if (!response.ok) throw new Error('ComfyUI 拒绝终止请求，请刷新原任务状态后核对')
    await response.body?.cancel()
  }
  socket(clientId: string): WebSocket {
    const url = new URL(this.url('ws'))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('clientId', clientId)
    return new WebSocket(url)
  }
  async upload(path: string): Promise<string> {
    const info = await stat(path)
    if (!info.isFile() || !info.size || info.size > 200 * 1024 * 1024) throw new Error('ComfyUI 参考素材超过 200MB 或文件无效')
    const form = new FormData()
    form.append('image', await openAsBlob(path), `${randomUUID()}${extname(path).toLowerCase()}`)
    form.append('type', 'input')
    const result = z.object({ name: z.string(), subfolder: z.string(), type: z.literal('input') }).parse(await this.request('upload/image', { method: 'POST', body: form, signal: AbortSignal.timeout(120000) }))
    const filename = result.subfolder ? `${result.subfolder}/${result.name}` : result.name
    if (filename.includes('\\') || filename.includes(':') || filename.startsWith('/') || filename.split('/').some((part) => !part || part === '..' || part === '.')) throw new Error('ComfyUI 返回的素材路径无效')
    return filename
  }
}

export class ComfySourceInspector {
  async hasRunningTasks(source: { address: string }): Promise<boolean> {
    const queue = z.object({ queue_running: z.array(z.unknown()) }).parse(
      await new ComfyClient(source.address).request('queue', { signal: AbortSignal.timeout(3000) })
    )
    return queue.queue_running.length > 0
  }

  async inspect(source: { address: string }): Promise<ComfyConnectionResult> {
    const client = new ComfyClient(source.address)
    let http = false
    const missingNodes: string[] = []
    let stage = '系统信息'
    try {
      await client.request('system_stats')
      stage = '任务队列'
      await client.request('queue')
      stage = '节点定义'
      z.record(z.string(), z.unknown()).parse(await client.request('object_info'))
      http = true
    } catch (error) {
      const detail = error instanceof Error && /^ComfyUI 接口返回 HTTP/.test(error.message) ? `：${error.message}` : '，请检查地址、端口和服务是否启动'
      return { http, websocket: false, missingNodes, message: `连接未通过「${stage}」检查${detail}` }
    }
    const websocket = await new Promise<boolean>((resolve) => {
      const socket = client.socket(randomUUID())
      const finish = (ok: boolean) => { clearTimeout(timer); socket.close(); resolve(ok) }
      const timer = setTimeout(() => finish(false), 8000)
      socket.addEventListener('open', () => finish(true), { once: true })
      socket.addEventListener('error', () => finish(false), { once: true })
    })
    return { http, websocket, missingNodes, message: missingNodes.length ? '服务可连接，工作流缺少节点' : websocket ? '服务及进度连接成功；模型文件与实际执行仍需生成验证' : '服务可连接，进度连接失败，可通过历史查询状态' }
  }
}
