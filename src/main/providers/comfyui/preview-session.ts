import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PreviewSession, PreviewSessionOptions } from '../../modules/jobs'
import type { PreviewSnapshot } from '../../../shared/contracts/preview'
import type { TaskDiagnostic } from '../../../shared/contracts/task-diagnostics'
import { ComfyClient } from './client'
import { inspectWorkflowPreview, restoreWorkflowPreviewDefinition, workflowPreviewDefinitionSchema, type WorkflowPreviewDefinition } from '../runninghub/workflow-preview'
import { parseSampling } from '../runninghub/preview-protocol'

const definitionSchema = z.object({ address: z.string(), clientId: z.string().optional(),
  preview: workflowPreviewDefinitionSchema.optional(), nodes: z.record(z.string(), z.string()).optional() })
const queueSchema = z.object({ queue_running: z.array(z.array(z.unknown())), queue_pending: z.array(z.array(z.unknown())) })
const fileSchema = z.object({ filename: z.string(), subfolder: z.string().default(''), type: z.enum(['output', 'temp']).default('output') })

export class ComfyPreviewSession implements PreviewSession {
  private state: PreviewSnapshot
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private socket?: WebSocket
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private activePrompt: string | null = null
  private socketConnected = false
  private definition: WorkflowPreviewDefinition | undefined
  private readonly nodes: Record<string, string>
  private readonly client: ComfyClient
  private readonly clientId: string
  private readonly loggedProgress = new Set<string>()
  constructor(private readonly options: PreviewSessionOptions) {
    this.state = structuredClone(options.initial)
    const definition = definitionSchema.parse(JSON.parse(options.workflowDefinition ?? '{}') as unknown)
    this.client = new ComfyClient(definition.address)
    this.clientId = definition.clientId ?? randomUUID()
    this.definition = definition.preview ? restoreWorkflowPreviewDefinition(definition.preview) : undefined
    this.nodes = definition.nodes ?? {}
    if (this.definition) this.state.capabilities = { ...this.definition.capabilities }
    else this.state.capabilities = { ...this.state.capabilities, status: 'ready', sampling: null, draft: null, final: null }
  }
  snapshot() { return structuredClone(this.state) }
  private log(entry: Omit<TaskDiagnostic, 'id' | 'taskId'>): void {
    this.options.diagnose?.({ ...entry, id: this.state.id, taskId: this.state.taskId })
  }
  private logProgress(sourceEvent: 'progress' | 'progress_state', step: number, total: number): void {
    // 普通进度只记录首次有效事件，避免高频节点更新挤占预览诊断。
    if (this.loggedProgress.has(sourceEvent)) return
    this.loggedProgress.add(sourceEvent)
    this.log({ event: 'socket', sourceEvent, reason: 'accepted', step, total })
  }
  private publish() {
    if (this.stopped) return
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = this.state
    this.options.emit({ type: 'state', state })
  }
  start(): void {
    // 即使实时连接尚未建立，任务队列也能导出本次会话的诊断。
    this.log({ event: 'socket', reason: 'connecting' })
    this.publish()
    this.connectSocket()
    void this.poll()
  }
  private connectSocket(): void {
    if (this.stopped) return
    const socket = this.client.socket(this.clientId)
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => {
      if (this.stopped || this.socket !== socket) return
      this.socketConnected = true
      this.log({ event: 'socket', reason: 'accepted' })
      this.state.connection = 'connected'; this.state.notice = ''; this.publish()
    })
    socket.addEventListener('message', (event) => {
      if (this.stopped || this.socket !== socket) return
      if (typeof event.data === 'string') this.receiveText(event.data)
      else if (event.data instanceof ArrayBuffer) this.receiveBinary(event.data)
    })
    const disconnected = () => {
      if (this.stopped || this.socket !== socket) return
      this.socketConnected = false; this.activePrompt = null
      this.state.connection = 'reconnecting'
      this.state.notice = '实时进度连接已断开，正在重连；队列和历史仍会继续查询，不会重新生成'
      this.publish()
      if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined
        socket.close(); this.connectSocket()
      }, 3000)
    }
    socket.addEventListener('close', disconnected)
    socket.addEventListener('error', disconnected)
  }
  private running(stage: string): void {
    this.state.remoteStatus = 'running'; this.state.runningObservedAt ??= new Date().toISOString()
    this.state.stage = stage
  }
  private receiveText(text: string): void {
    try {
      const message = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }).parse(JSON.parse(text) as unknown)
      const data = message.data
      const prompt = typeof data.prompt_id === 'string' ? data.prompt_id : null
      if (message.type === 'execution_start' || message.type === 'executing') {
        if (prompt) this.activePrompt = prompt
        if (prompt !== this.state.taskId) return
        if (data.node === null) { this.state.stage = 'ComfyUI 执行结束，正在核对输出'; this.publish(); return }
        const node = typeof data.node === 'string' ? data.node : ''
        this.running(`ComfyUI 正在执行${node ? `：${this.nodes[node] ?? node}` : ''}`)
        // 节点切换后旧节点的步数不能表示新阶段的进度。
        this.state.step = 0; this.state.total = 0; this.publish(); return
      }
      if (message.type === 'kj_preview_override') {
        const nodeId = String(data.node_id ?? '')
        const diagnostic = {
          event: 'sampling',
          sourceEvent: 'kj_preview_override',
          nodeId: /^[A-Za-z0-9_-]{1,100}$/.test(nodeId) ? nodeId : undefined,
          step: typeof data.step === 'number' && Number.isFinite(data.step) ? data.step : undefined,
          total: typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : undefined,
          width: typeof data.w === 'number' && Number.isSafeInteger(data.w) && data.w > 0 ? data.w : undefined,
          height: typeof data.h === 'number' && Number.isSafeInteger(data.h) && data.h > 0 ? data.h : undefined,
          audio: typeof data.audio === 'boolean' ? data.audio : undefined,
          mime: data.mime === 'image/jpeg' || data.mime === 'image/webp' || data.mime === 'video/mp4' || data.mime === 'image/png'
            ? data.mime : data.mime == null ? undefined : 'other',
          payloadLength: typeof data.image === 'string' ? data.image.length : 0
        } satisfies Omit<TaskDiagnostic, 'id' | 'taskId'>
        // KJ 不带 prompt_id，消息定向发送给提交时的独立 clientId；另以图节点白名单隔离。
        if (prompt && prompt !== this.state.taskId || this.activePrompt && this.activePrompt !== this.state.taskId) {
          this.log({ ...diagnostic, reason: 'task-mismatch' }); return
        }
        const definition = this.definition ?? { samplingNodes: [nodeId], videoOutputs: [], capabilities: this.state.capabilities }
        if (!nodeId || !definition.samplingNodes.includes(nodeId)) {
          this.log({ ...diagnostic, reason: nodeId ? 'node-mismatch' : 'schema' }); return
        }
        const sampling = parseSampling(data, definition)
        this.log({ ...diagnostic, reason: sampling?.media ? 'accepted' : sampling ? 'missing-image' : 'schema' })
        if (!sampling) return
        this.state.capabilities.sampling = true
        this.setProgress(sampling.step, sampling.total, 'ComfyUI 正在采样')
        if (sampling.media) this.samplingMedia(sampling.media)
        this.publish(); return
      }
      if (prompt !== this.state.taskId) return
      if (message.type === 'progress_state') {
        const nodes = z.record(z.string(), z.object({ state: z.string(), value: z.number().finite().nonnegative(), max: z.number().finite().positive(),
          display_node_id: z.string().optional() })).safeParse(data.nodes)
        if (!nodes.success) return
        const running = Object.entries(nodes.data).filter(([, node]) => node.state === 'running').at(-1)
        if (!running || running[1].value > running[1].max) return
        const [id, node] = running
        this.logProgress(message.type, node.value, node.max)
        this.activePrompt = prompt
        const name = this.nodes[node.display_node_id ?? id] ?? node.display_node_id ?? id
        this.setProgress(node.value, node.max, `ComfyUI 正在执行：${name}`); this.publish()
      } else if (message.type === 'progress') {
        const progress = z.object({ value: z.number().finite().nonnegative(), max: z.number().finite().positive() }).safeParse(data)
        if (!progress.success || progress.data.value > progress.data.max) return
        this.logProgress(message.type, progress.data.value, progress.data.max)
        this.activePrompt = prompt
        this.setProgress(progress.data.value, progress.data.max, 'ComfyUI 节点执行进度'); this.publish()
      } else if (message.type === 'execution_cached') {
        this.running('ComfyUI 正在复用已缓存节点'); this.publish()
      } else if (['execution_success', 'execution_error', 'execution_interrupted'].includes(message.type)) {
        this.state.stage = message.type === 'execution_success' ? 'ComfyUI 执行完成，正在核对输出' : 'ComfyUI 执行已停止，正在核对终态'
        this.publish()
      }
    } catch { /* 扩展事件或异常载荷不改变任务归属，历史查询继续兜底。 */ }
  }
  private setProgress(value: number, maximum: number, stage: string): void {
    this.state.step = value; this.state.total = maximum
    this.state.samplingStep = value; this.state.samplingTotal = maximum
    this.running(`${stage} · ${value}/${maximum}`)
  }
  private samplingMedia(media: NonNullable<PreviewSnapshot['sampling']>): void {
    this.state.capabilities.sampling = true; this.state.sampling = media
    this.options.emit({ type: 'media', id: this.state.id, kind: 'sampling', media })
  }
  private receiveBinary(data: ArrayBuffer): void {
    const diagnostic = { event: 'sampling', sourceEvent: 'binary', payloadLength: data.byteLength } as const
    // 原生旧版预览没有任务标识，仅在本连接明确观测到当前任务执行时接受。
    if (this.activePrompt !== this.state.taskId || data.byteLength < 12 || data.byteLength > 25 * 1024 * 1024) {
      this.log({ ...diagnostic, reason: this.activePrompt !== this.state.taskId ? 'task-mismatch' : data.byteLength < 12 ? 'schema' : 'oversized' }); return
    }
    const bytes = Buffer.from(data)
    const binaryType = bytes.readUInt32BE(0)
    if (binaryType !== 1) { this.log({ ...diagnostic, binaryType, reason: 'unsupported-type' }); return }
    const type = bytes.readUInt32BE(4)
    const mime = type === 1 ? 'image/jpeg' : type === 2 ? 'image/png' : null
    const payload = bytes.subarray(8)
    if (!mime || mime === 'image/jpeg' && (payload[0] !== 255 || payload[1] !== 216)
      || mime === 'image/png' && payload.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      this.log({ ...diagnostic, binaryType, mime: mime ?? 'other', reason: mime ? 'invalid-image' : 'unsupported-type' }); return
    }
    this.log({ ...diagnostic, binaryType, mime, reason: 'accepted' })
    this.samplingMedia({ source: `data:${mime};base64,${payload.toString('base64')}`, mime, receivedAt: new Date().toISOString() })
    this.publish()
  }
  private async poll(): Promise<void> {
    try {
      const history = z.record(z.string(), z.object({ outputs: z.record(z.string(), z.unknown()), status: z.object({ completed: z.boolean(), status_str: z.string(), messages: z.array(z.array(z.unknown())).optional() }).optional() })).parse(await this.client.request(`history/${encodeURIComponent(this.state.taskId)}`))
      if (this.stopped) return
      const result = history[this.state.taskId]
      this.state.connection = this.socketConnected ? 'connected' : 'reconnecting'
      if (result?.status?.completed || result?.status?.status_str === 'error') {
        const interrupted = result.status.messages?.some((item) => item[0] === 'execution_interrupted')
        this.state.remoteStatus = interrupted ? 'cancelled' : result.status.status_str === 'success' ? 'success' : 'failed'
        this.state.connection = 'completed'; this.state.completedAt = new Date().toISOString()
        this.state.stage = this.state.remoteStatus === 'success' ? 'ComfyUI 生成完成' : interrupted ? 'ComfyUI 已取消' : 'ComfyUI 执行失败，请检查服务日志'
        const messages = result.status.messages ?? []
        const started = messages.find((item) => item[0] === 'execution_start')?.[1]
        const ended = messages.find((item) => item[0] === 'execution_success' || item[0] === 'execution_error' || item[0] === 'execution_interrupted')?.[1]
        const timestamp = z.object({ timestamp: z.number().finite() })
        const start = timestamp.safeParse(started)
        const end = timestamp.safeParse(ended)
        if (start.success && end.success) this.state.executionSeconds = Math.max(0, (end.data.timestamp - start.data.timestamp) / 1000)
        const files = Object.values(result.outputs).flatMap((output) => {
          if (!output || typeof output !== 'object') return []
          return Object.values(output).flatMap((value) => Array.isArray(value) ? value.flatMap((entry: unknown) => {
            const parsed = fileSchema.safeParse(entry)
            return parsed.success && /\.mp4$/i.test(parsed.data.filename) ? [parsed.data] : []
          }) : [])
        })
        const videos = [...new Map(files.map((file) => {
          const source = `${this.client.url('view')}?${new URLSearchParams(file)}`
          return [source, { source, mime: 'video/mp4' as const, receivedAt: new Date().toISOString() }] as const
        })).values()]
        this.state.resultVideos = videos
        if (!this.state.sampling) this.log({ event: 'summary', reason: 'missing-sampling' })
        this.state.capabilities = { ...this.state.capabilities, status: 'ready', final: videos.length > 0, unclassifiedOutputs: videos.length > 1 ? videos.length : 0 }
        if (videos.length === 1) {
          this.state.final = videos[0]!
          this.options.emit({ type: 'media', id: this.state.id, kind: 'final', media: videos[0]! })
        } else if (this.state.remoteStatus === 'success') this.state.notice = videos.length ? '工作流有多个视频输出，请核对输出列表' : '工作流已执行完成，但未返回可识别的 MP4 输出'
        this.publish(); this.stop(); return
      }
      const queue = queueSchema.parse(await this.client.request('queue'))
      if (this.stopped) return
      if (!this.definition) {
        const original = [...queue.queue_running, ...queue.queue_pending].find((row) => row[1] === this.state.taskId)
        const graph = z.record(z.string(), z.object({ class_type: z.string(), inputs: z.record(z.string(), z.unknown()) })).safeParse(original?.[2])
        if (graph.success) {
          // 升级前任务只从原任务队列图恢复能力，不用用户当前配置猜测历史图。
          this.definition = inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify(graph.data) } })
          this.state.capabilities = { ...this.definition.capabilities, sampling: this.state.sampling ? true : this.definition.capabilities.sampling }
          for (const [id, node] of Object.entries(graph.data)) this.nodes[id] = node.class_type
        }
      }
      if (queue.queue_running.some((row) => row[1] === this.state.taskId)) {
        const current = queue.queue_running.find((row) => row[1] === this.state.taskId)
        const metadata = z.object({ client_id: z.string() }).safeParse(current?.[3])
        if (metadata.success && metadata.data.client_id === this.clientId) this.activePrompt = this.state.taskId
        if (this.state.remoteStatus !== 'running') this.running('ComfyUI 正在执行，等待节点进度')
      } else if (queue.queue_pending.some((row) => row[1] === this.state.taskId)) {
        this.state.remoteStatus = 'queued'; this.state.stage = '在指定 ComfyUI 实例中排队等待'
      } else { this.state.remoteStatus = 'unknown'; this.state.stage = 'ComfyUI 队列和历史中未找到任务，请核对；不会重新提交' }
      if (this.socketConnected) this.state.notice = ''
      this.publish()
    } catch {
      if (this.stopped) return
      this.state.connection = 'disconnected'; this.state.notice = 'ComfyUI 连接中断，将继续查询原任务，不切换来源或重新提交'; this.publish()
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 3000)
  }
  async cancel(): Promise<void> {
    if (this.stopped || ['success', 'failed', 'cancelled'].includes(this.state.remoteStatus)) return
    if (['requesting', 'requested'].includes(this.state.cancelState)) return
    const queue = queueSchema.parse(await this.client.request('queue'))
    if (this.stopped) return
    if (queue.queue_running.some((row) => row[1] === this.state.taskId)) {
      this.state.cancelState = 'requesting'; this.state.stage = '正在请求终止指定 ComfyUI 任务'; this.publish()
      try {
        await this.client.interrupt(this.state.taskId)
        if (this.stopped) return
        this.state.cancelState = 'requested'; this.state.cancelRequestedAt = new Date().toISOString()
        this.state.stage = 'ComfyUI 已接收终止请求，等待执行停止'
        this.state.notice = '终止需要等待当前计算检查中断；实际结果以原任务历史为准'
        this.publish()
      } catch (error) {
        if (this.stopped) return
        this.state.cancelState = 'uncertain'
        this.state.notice = error instanceof Error && /^(此 ComfyUI|ComfyUI 拒绝)/.test(error.message) ? error.message : '终止请求结果未确认，将继续核对原任务状态'
        this.publish()
        throw new Error(this.state.notice)
      }
      return
    }
    if (!queue.queue_pending.some((row) => row[1] === this.state.taskId)) throw new Error('任务已离开等待队列，请刷新状态后核对')
    // 只删除指定等待项，不使用清空队列或全局中断接口。
    await this.client.removeQueuedTask(this.state.taskId)
    const latest = queueSchema.parse(await this.client.request('queue'))
    if (latest.queue_running.some((row) => row[1] === this.state.taskId) || latest.queue_pending.some((row) => row[1] === this.state.taskId)) throw new Error('任务状态已变化，取消尚未确认，请在 ComfyUI 核对')
    const history = z.record(z.string(), z.unknown()).parse(await this.client.request(`history/${encodeURIComponent(this.state.taskId)}`))
    if (this.state.taskId in history) throw new Error('任务在取消期间已经执行，请刷新结果核对实际终态')
    this.state.cancelState = 'requested'; this.state.cancelRequestedAt = new Date().toISOString()
    this.state.remoteStatus = 'cancelled'; this.state.connection = 'completed'; this.state.stage = 'ComfyUI 等待任务已移除'
    this.state.notice = ''
    this.publish(); this.stop()
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.socket?.close() }
}
