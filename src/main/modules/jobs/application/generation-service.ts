import { scheduleGenerationSchema, submitGenerationSchema, type ScheduleGeneration, type SubmitGeneration } from '../../../../shared/contracts/generation'
import type { PreviewEvent, PreviewSnapshot } from '../../../../shared/contracts/preview'
import { h3PromptSchema } from '../../../../shared/contracts/h3'
import { continuousShotInputSchema } from '../../../../shared/contracts/continuity'
import type { GenerationContext, GenerationGateway, GenerationRecord, GenerationRepository, FinalVideoArchive } from '../ports/generation'
import { GenerationRejectedError } from '../ports/generation'
import type { PreviewService } from './preview-service'

const terminal = (task: PreviewSnapshot) => Boolean(task.manualCancellationConfirmedAt) || task.remoteStatus === 'success' || task.remoteStatus === 'failed' || task.remoteStatus === 'cancelled'

export class GenerationService {
  private readonly busyAccounts = new Set<string>()
  private readonly busyDrafts = new Set<string>()
  private readonly refreshingResults = new Set<string>()
  private readonly schedulingAccounts = new Set<string>()
  private readonly schedulingDrafts = new Set<string>()
  private stopped = false
  private snapshotPaused = false
  private readonly snapshotEvents = new Map<string, PreviewEvent>()
  private readonly archiving = new Map<string, AbortController>()
  private readonly preparingContinuity = new Map<string, AbortController>()
  private readonly continuityOperations = new Map<string, Promise<void>>()
  private readonly archiveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly repository: GenerationRepository, private readonly context: GenerationContext,
    private readonly gateway: GenerationGateway, private readonly previews: PreviewService,
    private readonly emit: (event: PreviewEvent) => void, private readonly finalArchive?: FinalVideoArchive) {}

  list(): PreviewSnapshot[] {
    const jobs = this.repository.list()
    return jobs.map((job) => ({ ...job.preview, continuitySourceJobId: this.continuitySource(job, jobs) }))
  }

  private continuitySource(job: GenerationRecord, jobs: GenerationRecord[]): string | undefined {
    if (job.draft.shotContinuity !== 'continuous') return undefined
    // 按任务提交时的引用快照匹配，历史记录不使用当前草稿或项目列表顺序猜前序。
    const sources = jobs.filter((source) => source.id !== job.id && source.preview.projectId === job.preview.projectId &&
      source.preview.continuityReference?.status === 'ready' && job.references.some((reference) =>
        reference.kind === 'video' && job.draft.prompt.includes(reference.label) && reference.assetId === source.preview.continuityReference?.videoAssetId))
    return sources.length === 1 ? sources[0]!.id : undefined
  }

  private capacityBlock(accountId: string, capacity: { limit: number; occupied: number }, replacements: Set<string>, currentId?: string): string | null {
    const reserved = this.repository.list().filter((job) => job.id !== currentId && job.preview.accountId === accountId &&
      !terminal(job.preview) && !job.preview.localReservationReleasedAt && !replacements.has(job.id))
    if (capacity.limit <= 0) return '远端同步的并发上限为 0，请核对该 Key 的并发权限'
    if (capacity.occupied >= capacity.limit) return `远端容量已满：当前任务 ${capacity.occupied}，并发上限 ${capacity.limit}`
    if (reserved.length < capacity.limit) return null
    // 未确认结束的任务不能因账号队列为空就直接丢掉；提示具体占位，避免误报远端已满。
    const pending = reserved.map((job) => `${job.preview.taskId || job.id}${job.preview.cancelState === 'requested' ? '（取消已受理，终态待确认）' : '（未确认结束）'}`).join('、')
    return `远端当前任务 ${capacity.occupied}/${capacity.limit}，但本地有 ${reserved.length} 笔未结束占位：${pending}。请刷新任务核对终态；同草稿重新生成须确认旧任务及重复计费风险`
  }
  hasStorageActivity(): boolean {
    return this.hasPending() || this.hasLocalStorageActivity()
  }
  hasLocalStorageActivity(): boolean {
    return this.busyAccounts.size > 0 || this.busyDrafts.size > 0 ||
      this.schedulingAccounts.size > 0 || this.schedulingDrafts.size > 0 || this.refreshingResults.size > 0 || this.archiving.size > 0 || this.preparingContinuity.size > 0
  }
  pauseForSnapshot(): () => void {
    if (this.hasLocalStorageActivity()) throw new Error('视频正在提交、下载或处理文件，请完成后再导出')
    this.snapshotPaused = true
    return () => {
      this.snapshotPaused = false
      const events = [...this.snapshotEvents.values()]
      this.snapshotEvents.clear()
      for (const event of events) this.emit(this.onPreview(event))
      for (const job of this.repository.list()) {
        this.archiveFinal(job)
        this.prepareContinuity(job)
      }
    }
  }
  hasPending(projectId?: string, draftId?: string, accountId?: string, workflowConfigId?: string): boolean {
    return this.repository.list().some((job) => !terminal(job.preview) &&
      (!projectId || job.preview.projectId === projectId) && (!draftId || job.preview.draftId === draftId) &&
      (!accountId || job.preview.accountId === accountId) && (!workflowConfigId || job.preview.workflowConfigId === workflowConfigId))
  }

  private confirmedReplacements(input: ScheduleGeneration): Set<string> {
    const ids = new Set(input.replacement?.taskIds ?? [])
    const jobs = this.repository.list()
    for (const id of ids) {
      const job = jobs.find((item) => item.id === id)
      if (!job || id === input.requestId || job.preview.projectId !== input.projectId || job.preview.draftId !== input.draftId ||
        !job.preview.taskId || !['accepted', 'uncertain'].includes(job.phase)) {
        throw new Error('重新生成确认与原任务不匹配，请刷新任务后重新确认')
      }
    }
    // 已解除占位或逐笔确认的旧任务可跳过；没有远端 ID 的受理不明请求仍禁止重提。
    if (jobs.some((job) => !terminal(job.preview) && !job.preview.localReservationReleasedAt && job.preview.projectId === input.projectId &&
      job.preview.draftId === input.draftId && !ids.has(job.id))) {
      throw new Error('该草稿已有未完成或受理不明的任务，请刷新后确认是否重新生成')
    }
    return ids
  }

  private publish(job: GenerationRecord): void {
    job.preview.continuitySourceJobId = this.continuitySource(job, this.repository.list())
    this.repository.save(job)
    const { sampling: _sampling, draft: _draft, final: _final, ...state } = job.preview
    this.emit({ type: 'state', state })
  }

  private releaseAcceptedCancellation(job: GenerationRecord): boolean {
    if (!job.preview.taskId || job.preview.cancelState !== 'requested' || job.preview.localReservationReleasedAt) return false
    // 平台受理取消即解除本地预留；不伪造远端终态，实际容量仍在下次提交前查询。
    job.preview.localReservationReleasedAt = job.preview.cancelRequestedAt ?? new Date().toISOString()
    return true
  }

  onPreview(event: PreviewEvent): PreviewEvent {
    const id = event.type === 'state' ? event.state.id : event.id
    // 快照复制期间不覆盖采样文件；每个任务仅保留各类最新事件，避免持续采样占满内存。
    if (this.snapshotPaused) {
      this.snapshotEvents.set(`${id}/${event.type === 'state' ? 'state' : event.kind}`, event)
      return event
    }
    const job = this.repository.list().find((item) => item.id === id)
    if (!job) return event
    if (event.type === 'state') job.preview = { ...job.preview, ...event.state, finalArchive: job.preview.finalArchive,
      continuityReference: job.preview.continuityReference,
      localReservationReleasedAt: job.preview.localReservationReleasedAt,
      ...(job.preview.manualCancellationConfirmedAt ? { manualCancellationConfirmedAt: job.preview.manualCancellationConfirmedAt } : {}) }
    // 采样媒体由持久化适配器归档到受管文件，任务快照保留索引和最近步数。
    else {
      job.preview[event.kind] = event.media
      if (event.kind === 'final' && job.preview.draft?.source === event.media.source) job.preview.draft = null
    }
    this.releaseAcceptedCancellation(job)
    try { this.repository.save(job) }
    catch (error) {
      if (event.type !== 'media' || event.kind !== 'sampling') throw error
      const { sampling: _sampling, draft: _draft, final: _final, ...state } = job.preview
      this.emit({ type: 'state', state: { ...state, notice: '采样归档失败，请检查磁盘空间和目录权限；当前画面仅在本次会话保留' } })
    }
    this.archiveFinal(job)
    this.prepareContinuity(job)
    if (event.type === 'state') {
      const { sampling: _sampling, draft: _draft, final: _final, ...state } = job.preview
      return { type: 'state', state }
    }
    return event
  }

  private archiveFinal(job: GenerationRecord): void {
    const media = job.preview.final
    if (this.stopped || this.snapshotPaused || !this.finalArchive || !media || media.mime !== 'video/mp4' || !media.source.startsWith('https:') || this.archiving.has(job.id) || this.archiveTimers.has(job.id)) return
    const previous = job.preview.finalArchive
    if (previous?.source === media.source && (previous.status === 'ready' || previous.attempts >= 3)) return
    const controller = new AbortController()
    this.archiving.set(job.id, controller)
    const attempts = previous?.source === media.source ? previous.attempts + 1 : 1
    job.preview.finalArchive = { status: 'downloading', source: media.source, attempts }
    try { this.publish(job) }
    catch {
      this.archiving.delete(job.id)
      const { sampling: _sampling, draft: _draft, final: _final, ...state } = job.preview
      this.emit({ type: 'state', state: { ...state, finalArchive: { status: 'failed', source: media.source, attempts,
        error: '无法保存归档状态，请检查磁盘空间和数据库权限后重试' } } })
      return
    }
    void this.finalArchive.save({ jobId: job.id, projectId: job.preview.projectId, draftId: job.preview.draftId,
      title: job.draft.title, prompt: job.draft.prompt, source: media.source, submittedAt: job.preview.submittedAt ?? job.createdAt }, controller.signal).then((assetId) => {
      if (this.stopped) return
      const current = this.repository.list().find((item) => item.id === job.id)
      if (!current) return
      current.preview.finalArchive = { status: 'ready', source: media.source, attempts, assetId }
      this.publish(current)
      this.prepareContinuity(current)
    }).catch(() => {
      if (this.stopped) return
      const current = this.repository.list().find((item) => item.id === job.id)
      if (!current) return
      current.preview.finalArchive = { status: 'failed', source: media.source, attempts,
        error: '成片本地归档失败，请检查网络、磁盘空间和目录权限；可重试归档，不会重新生成或扣费' }
      this.publish(current)
      if (attempts < 3) this.archiveTimers.set(job.id, setTimeout(() => {
        this.archiveTimers.delete(job.id)
        const latest = this.repository.list().find((item) => item.id === job.id)
        if (latest) this.archiveFinal(latest)
      }, attempts === 1 ? 5000 : 30000))
    }).finally(() => {
      this.archiving.delete(job.id)
      if (this.stopped) return
      const latest = this.repository.list().find((item) => item.id === job.id)
      if (latest?.preview.final && latest.preview.final.source !== media.source) this.archiveFinal(latest)
    }).catch(() => {
      if (this.stopped) return
      const { sampling: _sampling, draft: _draft, final: _final, ...state } = job.preview
      this.emit({ type: 'state', state: { ...state, finalArchive: { status: 'failed', source: media.source, attempts,
        error: '归档状态保存失败，请检查磁盘空间和数据库权限后重试' } } })
    })
  }

  private prepareContinuity(job: GenerationRecord, authorize: () => void = () => undefined): void {
    const archive = job.preview.finalArchive
    if (this.stopped || this.snapshotPaused || (!job.continuityRequest && job.draft.nextTransition !== 'continuous') || job.preview.remoteStatus !== 'success' ||
      archive?.status !== 'ready' || !archive.assetId || archive.source !== job.preview.final?.source || this.preparingContinuity.has(job.id)) return
    if (job.preview.continuityReference?.sourceAssetId === archive.assetId) return
    const assetId = archive.assetId
    const controller = new AbortController()
    this.preparingContinuity.set(job.id, controller)
    // 衍生素材是独立本地步骤；失败不能改变远端成功状态或重新提交付费任务。
    const operation = (async () => {
      try {
        job.preview.continuityReference = { status: 'processing', sourceAssetId: assetId }
        this.publish(job)
        if (!this.finalArchive?.prepareContinuity) throw new Error('尾段处理服务未配置')
        const result = await this.finalArchive.prepareContinuity({ jobId: job.id, projectId: job.preview.projectId,
          draftId: job.preview.draftId, title: job.draft.title, assetId, seconds: job.continuityRequest?.tailSeconds ?? job.draft.continuityTailSeconds ?? 1 }, controller.signal, authorize)
        authorize()
        const current = this.repository.list().find((item) => item.id === job.id)
        if (this.stopped || !current || current.preview.finalArchive?.assetId !== assetId || current.preview.final?.source !== archive.source) return
        current.preview.continuityReference = { status: 'ready', sourceAssetId: assetId, ...result }
        this.publish(current)
      } catch {
        if (this.stopped) return
        const current = this.repository.list().find((item) => item.id === job.id)
        if (!current || current.preview.finalArchive?.assetId !== assetId) return
        current.preview.continuityReference = { status: 'failed', sourceAssetId: assetId,
          error: '衔接素材未完成，请检查内置媒体引擎、素材与磁盘后重试；不会重新生成或扣费' }
        this.publish(current)
      } finally {
        this.preparingContinuity.delete(job.id)
        if (!this.stopped) {
          const latest = this.repository.list().find((item) => item.id === job.id)
          if (latest?.preview.finalArchive?.assetId !== assetId && latest) this.prepareContinuity(latest)
        }
      }
    })().catch(() => undefined)
    this.continuityOperations.set(job.id, operation)
    void operation.then(() => {
      if (this.continuityOperations.get(job.id) === operation) this.continuityOperations.delete(job.id)
    })
  }

  async prepareContinuityReference(input: { projectId: string; draftId: string; jobId: string; sourceAssetId: string; tailSeconds: number }, authorize: () => void = () => undefined) {
    authorize()
    if (this.stopped) throw new Error('应用正在退出')
    if (!this.finalArchive?.prepareContinuity) throw new Error('尾段处理服务未配置')
    if (!Number.isInteger(input.tailSeconds) || input.tailSeconds < 1 || input.tailSeconds > 5) throw new Error('尾段时长须为 1–5 秒')
    const job = this.repository.list().find((item) => item.id === input.jobId)
    const archive = job?.preview.finalArchive
    if (!job || job.preview.projectId !== input.projectId || job.preview.draftId !== input.draftId ||
      job.preview.remoteStatus !== 'success' || archive?.status !== 'ready' || archive.assetId !== input.sourceAssetId ||
      archive.source !== job.preview.final?.source) throw new Error('前序任务与已归档成片不匹配')
    const seconds = job.continuityRequest?.tailSeconds ?? job.draft.continuityTailSeconds ?? 1
    if (this.preparingContinuity.has(job.id)) throw new Error('该任务正在处理衔接素材，请稍后查询状态')
    // 本地补做配置独立于历史生成快照；不能为补尾段篡改原提示词或付费参数。
    if (seconds !== input.tailSeconds || job.preview.continuityReference?.status !== 'ready') job.preview.continuityReference = undefined
    job.continuityRequest = { tailSeconds: input.tailSeconds }
    this.publish(job)
    this.prepareContinuity(job, authorize)
    await this.continuityOperations.get(job.id)
    authorize()
    return this.continuityReferences(input.projectId).find((item) => item.jobId === job.id)
  }

  continuityReferences(projectId: string) {
    return this.repository.list().filter((job) => job.preview.projectId === projectId && (job.continuityRequest || job.draft.nextTransition === 'continuous' || job.preview.remoteStatus === 'success'))
      .map((job) => ({ jobId: job.id, draftId: job.preview.draftId, title: job.draft.title,
        nextTransition: job.draft.nextTransition ?? 'cut', sourceAssetId: job.preview.finalArchive?.assetId ?? null,
        tailSeconds: job.continuityRequest?.tailSeconds ?? job.draft.continuityTailSeconds ?? 1, reference: job.preview.continuityReference ?? null }))
  }

  confirmCancellation(input: { id: string; expectedTaskId: string; confirmed: true }): PreviewSnapshot {
    if (this.stopped) throw new Error('应用正在退出')
    const job = this.repository.list().find((item) => item.id === input.id)
    if (!input.confirmed || !job?.preview.taskId || job.preview.taskId !== input.expectedTaskId ||
      !['accepted', 'uncertain'].includes(job.phase) || terminal(job.preview)) throw new Error('任务状态已变化，请刷新后核对')
    if (job.preview.remoteStatus !== 'unknown' && job.preview.cancelState !== 'requested' && job.preview.connection !== 'disconnected') {
      throw new Error('只能人工确认待核对任务，运行中的任务请先请求取消')
    }
    // 人工确认不是平台回执：单独留痕，不改写最后观测到的远端状态，也不承诺退款。
    if (this.previews.list().some((task) => task.id === job.id)) this.previews.disconnect(job.id)
    const now = new Date().toISOString()
    job.preview = { ...job.preview, manualCancellationConfirmedAt: now, localReservationReleasedAt: job.preview.localReservationReleasedAt ?? now,
      connection: 'completed', stage: '用户已核实远端取消', notice: '人工确认已取消，非平台终态回执；不代表退款' }
    this.publish(job)
    return job.preview
  }

  releaseReservation(input: { id: string; expectedTaskId: string; confirmed: true }): PreviewSnapshot {
    if (this.stopped) throw new Error('应用正在退出')
    const job = this.repository.list().find((item) => item.id === input.id)
    if (!input.confirmed || !job?.preview.taskId || job.preview.taskId !== input.expectedTaskId ||
      !['accepted', 'uncertain'].includes(job.phase) || terminal(job.preview)) throw new Error('任务状态已变化，请刷新后核对；无远端 ID 的受理不明任务不能解除占位')
    if (job.preview.localReservationReleasedAt) return job.preview
    if (job.preview.remoteStatus !== 'unknown' && job.preview.cancelState !== 'requested' && job.preview.connection !== 'disconnected') {
      throw new Error('仅允许对状态待确认、取消已受理或监听断开的任务手动解除本地占位')
    }
    // 只解除本地容量预留；保留远端状态、监听和删除保护，提交仍检查平台实际容量。
    job.preview.localReservationReleasedAt = new Date().toISOString()
    this.publish(job)
    return job.preview
  }

  retryFinalArchive(id: string): void {
    if (this.stopped) throw new Error('应用正在退出')
    const job = this.repository.list().find((item) => item.id === id)
    if (!job?.preview.final) throw new Error('该任务尚无最终成片')
    if (job.preview.finalArchive?.status === 'ready') {
      if (job.preview.continuityReference?.status !== 'ready' && !this.preparingContinuity.has(id)) {
        job.preview.continuityReference = undefined
        this.prepareContinuity(job)
      }
      return
    }
    if (this.archiving.has(id)) return
    const timer = this.archiveTimers.get(id)
    if (timer) clearTimeout(timer)
    this.archiveTimers.delete(id)
    job.preview.finalArchive = undefined
    this.archiveFinal(job)
  }

  restore(): void {
    for (const job of this.repository.list()) {
      job.preview.requestedDuration ??= job.draft.duration
      if (this.releaseAcceptedCancellation(job)) this.publish(job)
      if (job.preview.finalArchive?.status !== 'ready') job.preview.finalArchive = undefined
      if (job.preview.continuityReference?.status === 'processing') job.preview.continuityReference = undefined
      this.archiveFinal(job)
      this.prepareContinuity(job)
      if (job.preview.remoteStatus === 'cancelled' || job.preview.manualCancellationConfirmedAt) continue
      if (terminal(job.preview)) {
        // 历史任务只重新查询结果和耗时；使用原角色快照，不以当前线上图猜历史节点。
        if (job.preview.taskId && (!job.preview.final || job.preview.executionSeconds === undefined)) this.listen(job)
        continue
      }
      if (job.phase === 'preparing') {
        job.phase = 'rejected'
        job.preview = { ...job.preview, remoteStatus: 'failed', connection: 'completed', stage: '上传阶段被中断，尚未提交生成' }
        this.publish(job)
      } else if (job.preview.taskId) {
        this.listen(job)
      } else {
        job.phase = 'uncertain'
        job.preview = { ...job.preview, connection: 'disconnected', stage: '提交受理待核对', notice: '应用在提交期间退出，不能确认是否扣费；请到 RunningHub 核对，禁止自动重提或换账号' }
        this.publish(job)
      }
    }
  }

  private listen(job: GenerationRecord, credential?: string): void {
    try {
      this.previews.restore(job.preview, credential ?? this.context.credential(job.preview.accountId), job.previewDefinition ?? undefined)
    } catch {
      job.preview = { ...job.preview, connection: 'disconnected', notice: '任务已保存，监听未恢复；请检查原账号配置后刷新任务列表，不要重新生成' }
      this.publish(job)
    }
  }

  resume(): void {
    const active = new Set(this.previews.list().map((task) => task.id))
    for (const job of this.repository.list()) if (job.preview.taskId && !terminal(job.preview) && !active.has(job.id)) this.listen(job)
  }

  async refreshResults(id: string, workflowUnchangedConfirmed: boolean): Promise<PreviewSnapshot> {
    if (this.stopped) throw new Error('应用正在退出，不能重新获取结果')
    if (this.refreshingResults.has(id)) throw new Error('正在重新获取该任务结果，请稍候')
    const original = this.repository.list().find((job) => job.id === id)
    if (!original?.preview.taskId || !terminal(original.preview)) throw new Error('只能重新获取已有终态任务的结果')
    this.refreshingResults.add(id)
    try {
      const credential = this.context.credential(original.preview.accountId)
      // 仅在用户确认线上工作流未变更时重建历史角色；不修改原任务或调用 create。
      const definition = workflowUnchangedConfirmed
        ? await this.gateway.inspectPreview(original.preview.workflowId, credential) : original.previewDefinition
      if (this.stopped) throw new Error('应用正在退出，结果获取已停止')
      const job = this.repository.list().find((item) => item.id === id)
      if (!job || job.preview.taskId !== original.preview.taskId || !terminal(job.preview)) throw new Error('任务记录已变化，请重新载入')
      if (workflowUnchangedConfirmed) {
        job.previewDefinition = definition
        job.previewDefinitionRecoveredAt = new Date().toISOString()
      }
      job.preview = { ...job.preview, requestedDuration: job.draft.duration, connection: 'connecting', stage: '正在重新获取平台结果', notice: '' }
      this.publish(job)
      if (this.previews.list().some((task) => task.id === id)) this.previews.disconnect(id)
      this.previews.restore(job.preview, credential, job.previewDefinition ?? undefined)
      return this.previews.get(id).snapshot()
    } finally { this.refreshingResults.delete(id) }
  }

  async schedule(input: ScheduleGeneration): Promise<PreviewSnapshot> {
    input = scheduleGenerationSchema.parse(input)
    if (this.stopped) throw new Error('应用正在退出，不能提交')
    const existing = this.repository.list().find((job) => job.id === input.requestId)
    if (existing) {
      if (existing.preview.projectId !== input.projectId || existing.preview.draftId !== input.draftId) throw new Error('提交标识与原任务不一致')
      return existing.preview
    }
    if (this.schedulingDrafts.has(input.draftId) || this.busyDrafts.has(input.draftId)) throw new Error('该草稿已有准备中或未完成的提交，请稍候')
    const replacements = this.confirmedReplacements(input)
    this.schedulingDrafts.add(input.draftId)
    try {
      const routes = this.context.routes?.() ?? []
      const blocked: string[] = []
      for (const route of routes) {
        if (this.stopped) throw new Error('应用正在退出，不能提交')
        if (this.busyAccounts.has(route.accountId) || this.schedulingAccounts.has(route.accountId)) {
          blocked.push('账号正在准备另一笔提交，请稍候')
          continue
        }
        // 容量探测期间先占住本地选择权，避免两个草稿同时选中同一个空位。
        this.schedulingAccounts.add(route.accountId)
        try {
          let capacity: { limit: number; occupied: number }
          try { capacity = await this.context.capacity(route.accountId) } catch {
            blocked.push('账号队列容量查询失败，未确认有无空位；余额同步成功不代表队列同步成功，请在账号池检查队列同步状态')
            continue
          }
          if (this.stopped) throw new Error('应用正在退出，不能提交')
          const reason = this.capacityBlock(route.accountId, capacity, replacements)
          if (reason) { blocked.push(reason); continue }
          // 一旦选定并进入提交流程就不换号；即使上传或受理失败也只返回原任务。
          return await this.submit({ ...input, workflowConfigId: route.configId, expectedAccountId: route.accountId, expectedWorkflowId: route.workflowId })
        } finally { this.schedulingAccounts.delete(route.accountId) }
      }
      throw new Error(routes.length ? [...new Set(blocked)].join('\n') : '没有可调度的账号工作流，请为启用账号设置默认工作流')
    } finally { this.schedulingDrafts.delete(input.draftId) }
  }

  async submit(input: SubmitGeneration): Promise<PreviewSnapshot> {
    input = submitGenerationSchema.parse(input)
    if (this.stopped) throw new Error('应用正在退出，不能提交')
    const existing = this.repository.list().find((job) => job.id === input.requestId)
    if (existing) {
      if (existing.preview.projectId !== input.projectId || existing.preview.draftId !== input.draftId || existing.preview.workflowConfigId !== input.workflowConfigId) throw new Error('提交标识与原任务不一致')
      return existing.preview
    }
    const workflow = this.context.workflow(input.workflowConfigId)
    if (workflow.accountId !== input.expectedAccountId || workflow.workflowId !== input.expectedWorkflowId) throw new Error('工作流归属或线上 ID 已变化，请重新选择并确认')
    if (this.busyAccounts.has(workflow.accountId)) throw new Error('该账号正在准备另一笔提交，请稍后再试')
    if (this.busyDrafts.has(input.draftId)) throw new Error('该草稿已有未完成的提交，请稍候')
    const replacements = this.confirmedReplacements(input)
    this.busyAccounts.add(workflow.accountId)
    this.busyDrafts.add(input.draftId)
    let job: GenerationRecord | undefined
    try {
      const draft = structuredClone(await this.context.draft(input.projectId, input.draftId, input.expectedRevision))
      h3PromptSchema.parse(draft.prompt)
      const media = this.context.references(input.draftId, input.projectId)
      const continuity = continuousShotInputSchema.safeParse({ ...draft, references: media.map((item) => item.reference) })
      if (!continuity.success) throw new Error(continuity.error.issues[0]?.message ?? '连续镜头视频引用不完整')
      for (const match of draft.prompt.matchAll(/<(Picture|Video|Audio) [1-9]\d*>/g)) {
        if (!media.some((item) => item.reference.label === match[0])) throw new Error(`未绑定素材：${match[0]}`)
      }
      if (!media.some((item) => item.reference.kind !== 'audio')) throw new Error('全能参考生成至少需要一张图片或一段视频')
      if (draft.instanceMode === 'auto') draft.instance = draft.duration <= 5 && media.filter((item) => item.reference.kind === 'image').length <= 3 ? 'default' : 'plus'
      const credential = this.context.credential(workflow.accountId)
      job = { id: input.requestId, phase: 'preparing', createdAt: new Date().toISOString(), draft,
        references: media.map((item) => item.reference), previewDefinition: null,
        ...(replacements.size ? { replacedTaskIds: [...replacements], regenerationConfirmedAt: new Date().toISOString() } : {}),
        preview: { id: input.requestId, taskId: '', workflowId: workflow.workflowId, workflowConfigId: input.workflowConfigId, accountId: workflow.accountId,
          projectId: input.projectId, draftId: input.draftId, connection: 'connecting', remoteStatus: 'unknown', stage: '正在校验线上工作流与账号容量',
          requestedDuration: draft.duration,
          capabilities: { status: 'checking', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
          step: 0, total: 0, samplingStep: 0, samplingTotal: 0, sampling: null, draft: null, final: null, notice: '', cancelState: 'none' } }
      // 在任何网络等待前落库；同草稿双击、跨窗口提交和重启不能丢掉占用记录。
      this.publish(job)
      const capacity = await this.context.capacity(workflow.accountId)
      // 手动重生成仅忽略已确认旧记录的本地预留，平台实际占用仍必须通过容量检查。
      const blocked = this.capacityBlock(workflow.accountId, capacity, replacements, job.id)
      if (blocked) throw new Error(blocked)
      const plan = await this.gateway.prepare(workflow.workflowId, credential, draft)
      job.previewDefinition = plan.previewDefinition
      const uploaded: { reference: typeof media[number]['reference']; filename: string }[] = []
      for (const item of media) {
        if (this.stopped) throw new Error('应用退出，素材上传中断，未提交生成')
        job.preview.stage = `上传参考素材 ${uploaded.length + 1}/${media.length}`
        this.publish(job)
        uploaded.push({ reference: item.reference, filename: await plan.upload(item.path, item.reference.kind) })
      }
      if (this.stopped) throw new Error('应用退出，未提交生成')
      const latestCapacity = await this.context.capacity(workflow.accountId)
      const latestBlocked = this.capacityBlock(workflow.accountId, latestCapacity, replacements, job.id)
      if (latestBlocked) throw new Error(`上传期间账号容量已变化，未发起生成：${latestBlocked}`)
      if (this.stopped) throw new Error('应用退出，未提交生成')
      job.phase = 'submitting'
      job.preview.submittedAt = new Date().toISOString()
      job.preview.stage = '正在提交付费生成，请勿重复操作'
      this.publish(job)
      // create 只调用一次；超时、解析失败及断网均保留受理不明，不自动重试。
      const taskId = await plan.create(uploaded)
      job.phase = 'accepted'
      job.preview = { ...job.preview, taskId, remoteStatus: 'queued', stage: '平台已受理，正在启动监听' }
      this.publish(job)
      if (!this.stopped) this.listen(job, credential)
      return job.preview
    } catch (error) {
      if (job) {
        const uncertain = job.phase === 'accepted' || job.phase === 'submitting' && !(error instanceof GenerationRejectedError)
        job.phase = uncertain ? 'uncertain' : 'rejected'
        job.preview = { ...job.preview, remoteStatus: uncertain ? 'unknown' : 'failed', connection: uncertain ? 'disconnected' : 'completed',
          stage: uncertain ? '提交受理待核对' : error instanceof GenerationRejectedError ? '平台明确拒绝创建任务' : '提交前失败，未发起生成', notice: uncertain
            ? '无法确认平台是否已受理，请到 RunningHub 核对；本任务不会自动重提或切换账号'
            : error instanceof Error ? error.message : '生成准备失败' }
        this.publish(job)
        return job.preview
      }
      throw error
    } finally { this.busyAccounts.delete(workflow.accountId); this.busyDrafts.delete(input.draftId) }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.archiveTimers.values()) clearTimeout(timer)
    this.archiveTimers.clear()
    for (const controller of this.archiving.values()) controller.abort()
    for (const controller of this.preparingContinuity.values()) controller.abort()
  }
}
