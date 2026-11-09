import { z } from 'zod'
import type { TaskDiagnostic } from '../../../shared/contracts/task-diagnostics'
import type { PreviewEvent, PreviewKind, PreviewMedia, PreviewSnapshot } from '../../../shared/contracts/preview'
import type { PreviewSession, PreviewSessionOptions } from '../../modules/jobs'
import { mergeTaskConsumption } from '../../modules/jobs'
import { allowedMediaUrl, allowedSocketUrl, parseOutput, parseSampling } from './preview-protocol'
import { classifyWorkflowVideo, inspectWorkflowPreview, restoreWorkflowPreviewDefinition, type WorkflowPreviewDefinition } from './workflow-preview'
import { parseTaskConsumption } from './task-consumption'

const eventSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })
const querySchema = z.object({
  taskId: z.string(), status: z.string(), results: z.array(z.object({ url: z.string(), outputType: z.string(), nodeId: z.string().max(100).nullable().optional() })).max(5000).nullable().optional()
})
const legacySchema = z.object({ code: z.number(), data: z.unknown() })
const socketSchema = z.object({ netWssUrl: z.string().nullable().optional() })
const outputResultsSchema = z.array(z.object({ nodeId: z.string().max(100), fileUrl: z.string().max(10000),
  fileType: z.string().max(100), taskCostTime: z.string().max(30).optional() })).max(5000)
const terminal = new Set(['success', 'failed', 'cancelled'])

export class RunningHubPreviewSession implements PreviewSession {
  private state: PreviewSnapshot
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private connectedAt = 0
  private stopped = false
  private cancelPending = false
  private failures = 0
  private resultAttempts = 0
  private polling: Promise<void> | null = null
  private repollRequested = false
  private controller = new AbortController()
  private credential: string
  private workflow: WorkflowPreviewDefinition | null = null
  private readonly emit: (event: PreviewEvent) => void
  private readonly workflowDefinition: string | undefined
  private readonly diagnose: PreviewSessionOptions['diagnose']

  constructor(options: PreviewSessionOptions) {
    this.state = options.initial
    this.credential = options.credential
    this.emit = options.emit
    this.workflowDefinition = options.workflowDefinition
    this.diagnose = options.diagnose
  }

  snapshot(): PreviewSnapshot { return structuredClone(this.state) }

  private log(entry: Omit<TaskDiagnostic, 'id' | 'taskId'>): void {
    try { this.diagnose?.({ ...entry, id: this.state.id, taskId: this.state.taskId }) }
    catch { /* 诊断失败不能改变任务状态。 */ }
  }

  private update(patch: Partial<PreviewSnapshot>): void {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = this.state
    this.emit({ type: 'state', state })
  }

  private media(kind: PreviewKind, media: PreviewMedia): void {
    if (this.stopped) return
    this.state[kind] = media
    if (kind === 'final' && this.state.draft?.source === media.source) this.state.draft = null
    this.emit({ type: 'media', id: this.state.id, kind, media })
  }

  start(): void { void this.initialize() }

  private async initialize(): Promise<void> {
    if (this.state.remoteStatus === 'cancelled') {
      this.update({ connection: 'completed', stage: '远端任务已取消', notice: '' })
      this.credential = ''
      return
    }
    try {
      if (this.workflowDefinition) {
        this.workflow = restoreWorkflowPreviewDefinition(JSON.parse(this.workflowDefinition) as unknown)
      } else {
        const result = await this.request('/api/openapi/getJsonApiFormat', {
          apiKey: this.credential, workflowId: this.state.workflowId
        })
        if (this.stopped) return
        this.workflow = inspectWorkflowPreview(result)
      }
      this.update({ capabilities: this.workflow.capabilities })
      for (const nodeId of this.workflow.samplingNodes) this.log({ event: 'workflow', nodeId, role: 'sampling' })
      for (const output of this.workflow.videoOutputs) this.log({ event: 'workflow', nodeId: output.nodeId, role: output.kind })
    } catch {
      if (this.stopped) return
      this.log({ event: 'workflow', reason: 'schema' })
      this.update({
        capabilities: { status: 'failed', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
        notice: '线上工作流读取失败，预览能力未确认；继续查询任务，不使用本地参考节点'
      })
    }
    await this.poll()
  }

  stop(): void {
    this.stopped = true
    this.credential = ''
    this.controller.abort()
    if (this.timer) clearTimeout(this.timer)
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.socket?.close()
    this.socket = null
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const endpoint = path.endsWith('/query') ? 'query' : path.endsWith('/outputs') ? 'outputs' : path.endsWith('/cancel') ? 'cancel' : 'workflow'
    let reason: TaskDiagnostic['reason'] = 'network'
    try {
      const response = await fetch(`https://www.runninghub.cn${path}`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.credential}` },
        body: JSON.stringify(body), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)])
      })
      this.log({ event: 'request', endpoint, httpStatus: response.status })
      if (!response.ok) { reason = 'http'; throw new Error('RunningHub 请求未成功') }
      const text = await response.text()
      if (text.length > 2 * 1024 * 1024) { reason = 'oversized'; throw new Error('任务查询响应过大') }
      reason = 'json'
      return JSON.parse(text) as unknown
    } catch (error) {
      this.log({ event: 'request-error', endpoint, reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : reason })
      throw error
    }
  }

  private poll(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.polling) return this.polling
    // 取消回执可触发即时复查，但不能与原轮询并行，避免旧响应回写覆盖新终态。
    this.polling = this.pollOnce().finally(() => {
      this.polling = null
      if (this.repollRequested && !this.stopped && !terminal.has(this.state.remoteStatus)) {
        this.repollRequested = false
        if (this.timer) clearTimeout(this.timer)
        void this.poll()
      }
    })
    return this.polling
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return
    try {
      const result = querySchema.parse(await this.request('/openapi/v2/query', { taskId: this.state.taskId }))
      if (this.stopped) return
      if (result.taskId !== this.state.taskId) {
        this.log({ event: 'query', reason: 'task-mismatch' })
        throw new Error('查询返回任务不匹配')
      }
      const status = result.status.trim().toUpperCase()
      const reportedStatus = status === 'SUCCESS' ? 'success' : status === 'FAILED' ? 'failed'
        : status === 'CANCELLED' || status === 'CANCELED' ? 'cancelled'
        : status === 'RUNNING' ? 'running' : status === 'QUEUED' || status === 'CREATE' ? 'queued' : 'unknown'
      // 已确认终态的历史结果补查不得因平台过期/滞后响应重新占用并发。
      const remoteStatus = terminal.has(this.state.remoteStatus) ? this.state.remoteStatus : reportedStatus
      const now = new Date().toISOString()
      this.log({ event: 'query', remoteStatus: reportedStatus, count: result.results?.length ?? 0 })
      this.update({ remoteStatus,
        ...(remoteStatus === 'running' && !this.state.runningObservedAt ? { runningObservedAt: now } : {}),
        ...(terminal.has(remoteStatus) && !this.state.completedAt ? { completedAt: now } : {}) })
      if (remoteStatus === 'cancelled') {
        this.update({ connection: 'completed', stage: '远端任务已取消', notice: '' })
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
        this.socket?.close()
        this.socket = null
        this.credential = ''
        return
      }
      if (terminal.has(remoteStatus)) {
        // V2 返回的有效地址先保存并展示，不能让角色分类或旧接口耗时查询阻塞媒体。
        let rejectedVideos = 0
        const resultVideos: PreviewMedia[] = []
        for (const output of result.results ?? []) {
          let host: string | undefined
          try { host = new URL(output.url).hostname } catch { /* 仅记录拒绝原因。 */ }
          const nodeId = output.nodeId && /^[A-Za-z0-9_-]{1,100}$/.test(output.nodeId) ? output.nodeId : undefined
          if (output.outputType.toLowerCase() !== 'mp4') {
            this.log({ event: 'output', nodeId, host, reason: 'unsupported-type' })
            continue
          }
          if (!allowedMediaUrl(output.url)) {
            rejectedVideos += 1
            this.log({ event: 'output', nodeId, host, reason: host ? 'domain-rejected' : 'invalid-url' })
            continue
          }
          const media: PreviewMedia = { source: output.url, mime: 'video/mp4', receivedAt: now }
          resultVideos.push(media)
          // V2 实际响应可带 nodeId；有节点身份时以原角色快照为准，不用文件名覆盖未知节点。
          const role = this.workflow ? output.nodeId
            ? this.workflow.videoOutputs.find((item) => item.nodeId === output.nodeId)?.kind ?? null
            : classifyWorkflowVideo(output.url, this.workflow) : null
          this.log({ event: 'output', nodeId, host, role: role ?? 'unclassified', reason: 'accepted' })
          if (role) this.media(role, media)
        }
        if (resultVideos.length) {
          const unique = [...new Map([...(this.state.resultVideos ?? []), ...resultVideos].map((media) => [media.source, media])).values()]
          this.update({ resultVideos: unique.slice(0, 100) })
        }
        this.update({ connection: 'completed', stage: remoteStatus === 'success' ? '远端任务已完成' : '远端任务失败', notice: '' })
        // 旧接口补充费用、节点身份和平台耗时；其失败不能推翻 V2 已确认的终态。
        try {
          const legacy = legacySchema.parse(await this.request('/task/openapi/outputs', { apiKey: this.credential, taskId: this.state.taskId }))
          if (this.stopped) return
          const outputs = outputResultsSchema.safeParse(legacy.data)
          if (remoteStatus === 'success' && legacy.code === 0 && Array.isArray(legacy.data)) {
            this.update({ consumption: mergeTaskConsumption(this.state.consumption, parseTaskConsumption(legacy.data)) })
          }
          this.log({ event: 'request', endpoint: 'outputs', platformCode: legacy.code, count: outputs.success ? outputs.data.length : 0 })
          if (legacy.code === 0 && outputs.success) {
            const times = new Set(outputs.data.flatMap((output) => output.taskCostTime && /^\d+(?:\.\d+)?$/.test(output.taskCostTime)
              && Number.isFinite(Number(output.taskCostTime)) ? [Number(output.taskCostTime)] : []))
            if (times.size === 1) this.update({ executionSeconds: [...times][0] })
            for (const output of outputs.data) {
              const role = this.workflow?.videoOutputs.find((item) => item.nodeId === output.nodeId)?.kind
              if (role && output.fileType.toLowerCase() === 'mp4' && allowedMediaUrl(output.fileUrl)) {
                this.media(role, { source: output.fileUrl, mime: 'video/mp4', receivedAt: now })
              }
            }
          }
        } catch (error) { this.log({ event: 'legacy-error', reason: error instanceof z.ZodError ? 'schema' : 'network' }) }
        if (this.stopped) return
        this.update({
          connection: 'completed', stage: remoteStatus === 'success' ? '远端任务已完成' : '远端任务失败',
          notice: remoteStatus === 'success' && !this.state.final ? rejectedVideos > 0
            ? `平台返回的视频中有 ${rejectedVideos} 个地址被安全规则拒绝，请导出任务诊断日志查看原因`
            : this.state.resultVideos?.length
            ? '已取得平台视频地址，低清与成片角色尚未分类；可查看下方平台视频输出'
            : '任务已完成，平台暂未返回可识别的视频地址' : ''
        })
        this.log({ event: 'summary', reason: this.state.final ? 'complete' : 'missing-final', count: this.state.resultVideos?.length ?? 0 })
        if (this.workflow?.capabilities.sampling && !this.state.sampling) this.log({ event: 'sampling', reason: 'missing-sampling', count: 0 })
        const missingMedia = remoteStatus === 'success' && (this.workflow?.capabilities.final && !this.state.final || this.workflow?.capabilities.draft && !this.state.draft)
        if (missingMedia && ++this.resultAttempts < 3) {
          this.timer = setTimeout(() => void this.poll(), 5000)
          return
        }
        this.socket?.close()
        this.socket = null
        this.credential = ''
        return
      }
      // 取消受理后只核对任务终态，预览输出接口不可用不能拖慢取消确认。
      if (this.state.cancelState === 'requested') {
        this.update({ connection: 'connected', stage: '取消已受理，正在核对远端终态', notice: '取消请求已受理，尚未确认远端终止；不保证退款' })
        this.failures = 0
        if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 3000)
        return
      }
      const canPreview = this.workflow && (this.workflow.samplingNodes.length > 0 || this.workflow.videoOutputs.length > 0)
      if (!canPreview) this.update({ connection: 'connected', stage: remoteStatus === 'queued' ? '远端排队中' : '正在查询远端任务' })
      if (canPreview && (!this.socket || this.socket.readyState === WebSocket.CLOSED)) {
        // 仅此兼容路径获取 netWssUrl；业务终态始终来自 V2，不把旧 outputs 当新查询结构。
        const legacy = legacySchema.parse(await this.request('/task/openapi/outputs', { apiKey: this.credential, taskId: this.state.taskId }))
        if (this.stopped || this.snapshot().cancelState === 'requested') return
        const connection = socketSchema.safeParse(legacy.data)
        const url = connection.success ? connection.data.netWssUrl : null
        this.log({ event: 'request', endpoint: 'outputs', platformCode: legacy.code })
        if (url) {
          if (!allowedSocketUrl(url)) throw new Error('平台返回的监听域名尚未获准')
          this.openSocket(url)
        } else {
          this.log({ event: 'socket', reason: connection.success ? 'missing-socket' : 'schema' })
          this.update({ connection: 'connecting', stage: remoteStatus === 'queued' ? '远端排队中' : '等待平台分配预览连接' })
        }
      }
      if (this.state.capabilities.sampling === true && this.connectedAt && !this.state.sampling && !this.state.draft && Date.now() - this.connectedAt > 60000) {
        this.update({ notice: '平台尚未转发采样预览事件；任务查询继续，是否支持自定义事件需实测确认' })
      }
      this.failures = 0
    } catch (error) {
      if (this.stopped) return
      this.log({ event: 'query', reason: error instanceof z.ZodError ? 'schema' : 'network' })
      this.failures += 1
      if (terminal.has(this.state.remoteStatus) && this.failures >= 3) {
        this.update({ connection: 'completed', notice: '保留已确认的任务终态，结果补查失败；请检查原账号权限或平台结果有效期' })
        this.socket?.close()
        this.socket = null
        this.credential = ''
        return
      }
      this.update({
        connection: 'reconnecting',
        notice: this.state.cancelState === 'requested'
          ? '取消已受理，但远端终态查询失败；不会自动重提，请核对原任务状态'
          : '查询或预览连接不可用，将继续查询；如持续失败请检查 Key、任务归属及平台连接支持'
      })
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), Math.min(30000, 5000 * Math.max(1, this.failures)))
  }

  private openSocket(url: string): void {
    if (this.stopped) return
    const socket = new WebSocket(url)
    this.socket = socket
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) socket.close()
    }, 20000)
    socket.addEventListener('open', () => {
      if (this.stopped || this.socket !== socket) return
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.connectedAt = Date.now()
      this.log({ event: 'socket', reason: 'accepted' })
      this.update({ connection: 'connected', notice: '', stage: '等待工作流预览' })
    })
    socket.addEventListener('message', (event) => {
      if (this.stopped || this.socket !== socket) return
      if (typeof event.data !== 'string') { this.log({ event: 'socket', reason: 'unsupported-type' }); return }
      if (event.data.length > 25 * 1024 * 1024) { this.log({ event: 'socket', reason: 'oversized' }); return }
      try { this.receive(JSON.parse(event.data) as unknown) } catch { /* 畸形事件不改变已有媒体和任务状态。 */ }
    })
    const disconnected = () => {
      if (this.stopped || this.socket !== socket || terminal.has(this.state.remoteStatus) || this.state.cancelState === 'requested') return
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.log({ event: 'socket', reason: 'closed' })
      this.update({ connection: 'reconnecting', notice: '预览连接已断开，保留最近画面并等待重连' })
    }
    socket.addEventListener('error', disconnected)
    socket.addEventListener('close', disconnected)
  }

  private receive(value: unknown): void {
    if (this.state.remoteStatus === 'cancelled') return
    const result = eventSchema.safeParse(value)
    if (!result.success) return
    const { type, data } = result.data
    if (typeof data.taskId === 'string' && data.taskId !== this.state.taskId) return
    if (type === 'kj_preview_override') {
      const sampling = this.workflow ? parseSampling(data, this.workflow) : null
      this.log({ event: 'sampling', reason: sampling ? 'accepted' : 'schema', count: sampling?.media ? 1 : 0 })
      if (!sampling) return
      this.update({ step: sampling.step, total: sampling.total, samplingStep: sampling.step, samplingTotal: sampling.total,
        ...(!this.state.runningObservedAt && !terminal.has(this.state.remoteStatus) ? { runningObservedAt: new Date().toISOString() } : {}),
        stage: this.state.draft ? '低清已就绪，继续处理最终成片' : '采样中', notice: '' })
      if (sampling.media) this.media('sampling', sampling.media)
    } else if (type === 'executed' && typeof data.node === 'string') {
      const output = this.workflow ? parseOutput(data.node, data.output, this.workflow) : null
      if (output) {
        this.media(output.kind, output.media)
        if (output.kind === 'draft') this.update({ stage: '低清视频已就绪，等待最终成片' })
      }
    } else if (type === 'progress' && typeof data.value === 'number' && typeof data.max === 'number') {
      if (Number.isFinite(data.value) && Number.isFinite(data.max) && data.value >= 0 && data.max > 0) {
        this.update({ step: Math.min(data.value, data.max), total: data.max })
      }
    } else if (type === 'execution_success') {
      this.update({ stage: '执行结束，正在核对远端结果' })
    }
  }

  async cancel(): Promise<void> {
    if (this.stopped || terminal.has(this.state.remoteStatus) || !this.credential) throw new Error('该任务不能再请求取消')
    if (this.cancelPending || this.state.cancelState === 'requested') return
    this.cancelPending = true
    this.update({ cancelState: 'requesting' })
    try {
      const response = z.object({ code: z.number() }).parse(await this.request('/task/openapi/cancel', {
        apiKey: this.credential, taskId: this.state.taskId
      }))
      if (terminal.has(this.state.remoteStatus) || this.stopped) return
      if (response.code !== 0) {
        this.update({ cancelState: 'rejected', notice: '取消被平台拒绝，请核对原账户和任务；任务状态继续查询' })
        throw new Error('平台未接受取消请求')
      }
      this.update({ cancelState: 'requested', cancelRequestedAt: new Date().toISOString(), stage: '取消已受理，正在核对远端终态', notice: '平台已接受取消请求，计时已暂停，正在核对是否终止；不保证退款' })
      if (this.timer) clearTimeout(this.timer)
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.socket?.close()
      this.socket = null
      if (this.polling) this.repollRequested = true
      else void this.poll()
    } catch {
      if (terminal.has(this.state.remoteStatus) || this.stopped) return
      if (this.state.cancelState !== 'rejected') this.update({ cancelState: 'uncertain', notice: '取消结果不明，继续查询；请勿重复生成' })
      throw new Error('取消结果未确认，请查看任务状态')
    } finally { this.cancelPending = false }
  }
}
