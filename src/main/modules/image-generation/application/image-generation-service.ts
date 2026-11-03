import { z } from 'zod'
import { createImageBoardSchema, createImageNodeSchema, imageAccountSchema, imageBoardSchema, imageNodeSchema,
  saveImageAccountSchema, saveImageNodeSchema, saveImageLayoutSchema, submitImageNodesSchema, imageNodeActionSchema, reviewImageNodeSchema, imageExecutionSettingsSchema,
  type CreateImageBoard, type CreateImageNode, type ImageNode, type SaveImageAccount, type SaveImageNode, type SaveImageLayout,
  mcpSubmitImageNodesSchema, type McpSubmitImageNodes,
  type SubmitImageNodes, type ImageNodeAction, type ReviewImageNode, type ImageExecutionSettings } from '../../../../shared/contracts/image-generation'
import type { ImageGenerationAssets, ImageGenerationRepository, ImageCredentialVault, ImageGateway, ImageOutput, ImageSubmissionReceipt } from '../ports/image-generation'
import { isImageDraft, occupiesImageCapacity } from '../domain/task-policy'
import { deleteImageNodesSchema, type DeleteImageNodes } from '../../../../shared/contracts/image-generation'
import { ImageHttpError, ImageRequestError } from '../domain/image-errors'
export { ImageHttpError, ImageRequestError } from '../domain/image-errors'

const outputSchema = z.object({ b64_json: z.string().optional(), url: z.string().url().optional() })

export class ImageGenerationService {
  private active = new Map<string, AbortController>()
  private submissionAuthorizations = new Map<string, () => void>()
  private stopped = false
  private snapshotPaused = false
  pauseForSnapshot(): () => void {
    if (this.hasActivity()) throw new Error('生图正在生成或下载，请完成后再导出')
    this.snapshotPaused = true
    return () => { this.snapshotPaused = false; this.schedule() }
  }
  private scheduling = false
  private scheduleRequested = false
  constructor(private readonly repository: ImageGenerationRepository, private readonly assets: ImageGenerationAssets,
    private readonly vault: ImageCredentialVault, private readonly gateway: ImageGateway, private readonly id: () => string) {}
  accounts() { return this.repository.accounts().map((record) => record.account) }
  protocols() { return this.gateway.protocols?.() ?? [] }
  settings() { return this.repository.settings() }
  saveSettings(input: ImageExecutionSettings) {
    this.repository.saveSettings(imageExecutionSettingsSchema.parse(input))
    this.schedule()
    return this.settings()
  }
  boards(projectId: string | null) { return this.repository.boards(projectId) }
  board(id: string) { return this.repository.board(id) }
  nodes(boardId: string) { this.board(boardId); return this.repository.nodes(boardId).filter((node) => !node.deletedAt) }
  async deleteNodes(raw: DeleteImageNodes, authorize: () => void = () => undefined) {
    const input = deleteImageNodesSchema.parse(raw)
    const board = this.board(input.boardId)
    await this.assets.assertProject(board.projectId)
    authorize()
    if (new Set(input.nodes.map((item) => item.id)).size !== input.nodes.length) throw new Error('任务列表重复')
    // 异步授权检查后重新读取；整批校验再原子落库，不把删除当作远端取消。
    const nodes = input.nodes.map((action) => {
      const node = this.current(action)
      if (node.boardId !== board.id) throw new Error('任务不属于授权画布')
      if (this.active.has(node.id) || !['draft', 'not_submitted', 'saved', 'resolved', 'output_unavailable'].includes(node.status)) {
        throw new Error('排队、生成中、下载中或受理不明任务不能删除，请先撤回排队或核实远端状态')
      }
      return node
    })
    const now = new Date().toISOString()
    const deleted = nodes.map((node) => imageNodeSchema.parse({ ...node, deletedAt: now, updatedAt: now, revision: node.revision + 1 }))
    this.repository.saveNodes(deleted, nodes.map((node) => node.revision))
    return { ids: deleted.map((node) => node.id) }
  }
  async diagnoseNode(id: string, authorize: () => void = () => undefined) {
    const node = this.repository.node(id)
    this.board(node.boardId)
    await this.assets.assertProject(node.projectId)
    authorize()
    const cipher = this.repository.output(id)
    const summary = { id: node.id, boardId: node.boardId, revision: node.revision, status: node.status, error: node.error,
      hasCachedOutput: Boolean(cipher), active: this.active.has(id), assetId: node.assetId }
    if (!cipher) return { ...summary, output: null, cacheError: null }
    try {
      const output = outputSchema.parse(JSON.parse(this.vault.open(cipher)))
      const diagnostics = await this.gateway.diagnoseOutput(output, node.accountSnapshot?.baseUrl ?? null)
      authorize()
      return { ...summary, output: diagnostics, cacheError: null }
    } catch {
      authorize()
      return { ...summary, output: null, cacheError: '缓存结果无法解密、解析或诊断；未返回原始结果或异常正文' }
    }
  }
  references(assetId: string) { return this.repository.references(assetId) }
  hasPending(projectId?: string | null): boolean {
    return this.repository.nodes().some((node) => (projectId === undefined || node.projectId === projectId) &&
      (node.status === 'queued' || occupiesImageCapacity(node) || node.status === 'downloading'))
  }
  hasActivity() { return this.active.size > 0 }
  async saveAccount(raw: SaveImageAccount) {
    const input = saveImageAccountSchema.parse(raw)
    const previous = input.id ? this.repository.accounts().find((record) => record.account.id === input.id) : undefined
    if (input.id && !previous) throw new Error('账号不存在')
    if (previous && this.repository.nodes().some((node) => node.accountId === input.id &&
      (node.status === 'queued' || occupiesImageCapacity(node) || node.status === 'downloading'))) throw new Error('该账号仍有在途或受理不明任务，不能修改')
    const key = input.apiKey?.trim()
    if (key && /\s/.test(key)) throw new Error('API Key 必须为单行且不含空白')
    if (!previous && !key) throw new Error('请输入 API Key')
    const sealed = key ? this.vault.seal(key) : previous!
    const groupStopped = this.repository.accounts().some((record) => record.account.accountGroup === input.accountGroup && record.account.stopped)
    const account = imageAccountSchema.parse({ ...input, protocol: input.protocol ?? previous?.account.protocol ?? 'openai-images', id: input.id ?? this.id(), revision: input.expectedRevision + 1, stopped: groupStopped || previous?.account.stopped || false })
    this.gateway.validate?.(account)
    for (const other of this.repository.accounts()) {
      if (other.account.id === account.id) continue
      if (other.account.accountGroup === account.accountGroup && other.account.maxConcurrency !== account.maxConcurrency) throw new Error('同一实际账号组必须使用相同并发上限')
      if (other.fingerprint === sealed.fingerprint && new URL(other.account.baseUrl).origin === new URL(account.baseUrl).origin && other.account.accountGroup !== account.accountGroup) throw new Error('同站相同 Key 必须归入同一实际账号组')
    }
    this.repository.saveAccount({ account, cipher: sealed.cipher, fingerprint: sealed.fingerprint }, input.expectedRevision)
    this.schedule()
    return this.accounts()
  }
  async createBoard(raw: CreateImageBoard, authorize: () => void = () => undefined) {
    const input = createImageBoardSchema.parse(raw)
    await this.assets.assertProject(input.projectId)
    authorize()
    const previous = this.repository.boards(input.projectId).find((board) => board.id === input.id)
    if (previous) {
      if (previous.title !== input.title) throw new Error('画布 ID 已用于不同内容')
      return previous
    }
    const now = new Date().toISOString()
    const board = imageBoardSchema.parse({ ...input, revision: 1, positions: {}, createdAt: now, updatedAt: now })
    this.repository.saveBoard(board, 0)
    return board
  }
  async createNode(raw: CreateImageNode, authorize: () => void = () => undefined) {
    const input = createImageNodeSchema.parse(raw)
    const board = this.board(input.boardId)
    await this.assets.assertProject(board.projectId)
    this.checkReferences(input.references, board.projectId)
    authorize()
    const previous = this.repository.nodes(board.id).find((node) => node.id === input.id)
    if (previous) {
      if (previous.deletedAt) throw new Error('图片任务已删除，不能复活，请使用新的 UUID')
      if (previous.sourceNodeId !== input.sourceNodeId || previous.title !== input.title || previous.prompt !== input.prompt || previous.size !== input.size ||
        previous.accountId !== input.accountId || previous.references.length !== input.references.length ||
        previous.references.some((reference, index) => reference.assetId !== input.references[index]?.assetId ||
          reference.expectedUpdatedAt !== input.references[index]?.expectedUpdatedAt)) throw new Error('节点 ID 已用于不同内容')
      return previous
    }
    this.assertVersionSource(input)
    let assetIdOccupied = false
    try { this.assets.get(input.id); assetIdOccupied = true } catch { /* 未登记的 UUID 才可用于新输出。 */ }
    if (assetIdOccupied) throw new Error('节点 ID 已被素材使用，请生成新的 UUID')
    const now = new Date().toISOString()
    const node = imageNodeSchema.parse({ ...input, projectId: board.projectId, revision: 1, status: 'draft',
      createdAt: now, updatedAt: now, submittedAt: null, accountSnapshot: null, assetId: null, review: 'pending', error: '' })
    this.repository.saveNodes([node], [0])
    return node
  }
  private assertVersionSource(input: Pick<ImageNode, 'boardId' | 'sourceNodeId'>, existingDraft = false) {
    if (!input.sourceNodeId) return
    const source = this.repository.node(input.sourceNodeId)
    if (source.boardId !== input.boardId) throw new Error('来源任务不属于当前任务组，不可用')
    // 已有副本可独立提交；删除从未发送的旧草稿不代表它仍占用远端请求。
    if (source.deletedAt && !(existingDraft && isImageDraft(source) && !source.submittedAt)) {
      throw new Error(`来源任务“${source.title}”已删除，不可用；请新建独立任务，不要解除占用或重提旧请求`)
    }
    if (source.status === 'acceptance_unknown') {
      throw new Error(`来源任务“${source.title}”受理不明；请打开来源任务，在原服务核实结束后解除本地占用`)
    }
    // 派生与提交都检查真实在途状态，不能通过复制草稿重复发送未结束的原请求。
    if (this.active.has(source.id) || !['draft', 'not_submitted', 'saved', 'resolved', 'output_unavailable'].includes(source.status)) {
      throw new Error(`来源任务“${source.title}”仍在途（${source.status}）；请打开来源任务查看状态，等待结束，勿重复提交`)
    }
  }
  async saveNode(raw: SaveImageNode) {
    const { expectedRevision, ...input } = saveImageNodeSchema.parse(raw)
    const node = this.current({ id: input.id, expectedRevision })
    if (!isImageDraft(node)) throw new Error('已提交记录不能覆盖，请使用重新生成并保留历史结果')
    await this.assets.assertProject(node.projectId)
    // 异步项目校验期间任务可能被其他入口提交，落库前重新校验修订。
    this.current({ id: input.id, expectedRevision })
    this.checkReferences(input.references, node.projectId)
    return this.change(node, { ...input, automaticAccount: input.accountId === null, status: 'draft', error: '' })
  }
  async saveLayout(raw: SaveImageLayout) {
    const input = saveImageLayoutSchema.parse(raw)
    await this.assets.assertProject(this.board(input.id).projectId)
    const board = this.board(input.id)
    if (board.revision !== input.expectedRevision) throw new Error('画布已更新，请重新打开')
    // 移出画布只更新展示状态，不删除任务、素材或冻结的历史引用。
    const saved = { ...board, positions: input.positions, hiddenNodeIds: input.hiddenNodeIds ?? board.hiddenNodeIds,
      revision: board.revision + 1, updatedAt: new Date().toISOString() }
    this.repository.saveBoard(saved, input.expectedRevision)
    return saved
  }
  private current(input: ImageNodeAction) {
    const node = this.repository.node(input.id)
    this.board(node.boardId)
    if (node.deletedAt) throw new Error('图片任务已删除')
    if (node.revision !== input.expectedRevision) throw new Error('任务已更新，请刷新后重试')
    return node
  }
  private change(node: ImageNode, fields: Partial<ImageNode>) {
    const saved = imageNodeSchema.parse({ ...node, ...fields, revision: node.revision + 1, updatedAt: new Date().toISOString() })
    this.repository.saveNodes([saved], [node.revision])
    return saved
  }
  private checkReferences(references: ImageNode['references'], projectId: string | null) {
    if (new Set(references.map((ref) => ref.assetId)).size !== references.length) throw new Error('参考图片重复')
    for (const ref of references) {
      const asset = this.assets.get(ref.assetId)
      if (asset.kind !== 'image' || asset.archived || asset.projectId !== null && asset.projectId !== projectId || asset.updatedAt !== ref.expectedUpdatedAt) throw new Error('参考图片已变化、已归档或不属于当前项目，请重新选择')
    }
  }
  async submitFromMcp(raw: McpSubmitImageNodes, authorize: () => void) {
    const input = mcpSubmitImageNodesSchema.parse(raw)
    authorize()
    const serialized = JSON.stringify({ boardId: input.boardId, nodes: [...input.nodes].sort((a, b) => a.id.localeCompare(b.id)) })
    const existing = this.repository.submission(input.requestKey)
    if (existing) {
      if (existing.input !== serialized) throw new Error('提交请求键已用于不同内容')
      return existing.nodeIds.map((id) => this.repository.node(id))
    }
    for (const action of input.nodes) if (this.current(action).boardId !== input.boardId) throw new Error('任务不属于授权画布')
    return this.enqueue({ nodes: input.nodes, confirmed: true }, authorize, {
      requestKey: input.requestKey, input: serialized, nodeIds: input.nodes.map((item) => item.id), createdAt: new Date().toISOString()
    })
  }
  async submit(raw: SubmitImageNodes) {
    return this.enqueue(raw)
  }
  private selectAccount(node: ImageNode, requireCapacity: boolean) {
    const records = this.repository.accounts()
    const nodes = this.repository.nodes()
    const load = (group: string) => nodes.filter((item) => occupiesImageCapacity(item) && item.accountSnapshot?.accountGroup === group).length
    const automatic = node.accountId === null || node.automaticAccount
    const candidates = records.filter(({ account }) => (automatic || account.id === node.accountId) && account.enabled &&
      !records.some((other) => other.account.accountGroup === account.accountGroup && other.account.stopped) &&
      (!requireCapacity || load(account.accountGroup) < account.maxConcurrency))
      .filter(({ account }) => { try { this.gateway.validate?.(account, node); return true } catch { return false } })
    // 先比较实际账号组负载，再比较历史领取次数；同组多个 Key 不增加可用并发。
    candidates.sort((a, b) => load(a.account.accountGroup) / a.account.maxConcurrency - load(b.account.accountGroup) / b.account.maxConcurrency ||
      nodes.filter((item) => item.accountSnapshot?.accountGroup === a.account.accountGroup).length -
      nodes.filter((item) => item.accountSnapshot?.accountGroup === b.account.accountGroup).length || a.account.id.localeCompare(b.account.id))
    return candidates[0]
  }
  private async enqueue(raw: SubmitImageNodes, authorize: () => void = () => undefined, submission?: ImageSubmissionReceipt) {
    const input = submitImageNodesSchema.parse(raw)
    if (this.stopped) throw new Error('软件正在退出，不能提交')
    if (new Set(input.nodes.map((item) => item.id)).size !== input.nodes.length) throw new Error('任务列表重复')
    const nodes = input.nodes.map((item) => this.current(item))
    for (const node of nodes) {
      if (!isImageDraft(node)) throw new Error('只能提交待提交任务，已提交任务不会重提')
      if (!node.prompt.trim()) throw new Error('请填写提示词后再提交生成')
      await this.assets.assertProject(node.projectId)
      this.checkReferences(node.references, node.projectId)
      const account = this.selectAccount(node, false)
      if (!account) throw new Error('没有支持当前尺寸和参考图的可用生图账号，请检查账号启用状态及协议能力')
      this.gateway.validate?.(account.account, node)
      this.vault.open(account.cipher)
    }
    // 提示词、尺寸和引用整批冻结；自动账号在领取容量时确定，固定账号在此保留快照。
    const queued = nodes.map((node) => {
      const automaticAccount = node.accountId === null || node.automaticAccount
      const account = this.accounts().find((item) => item.id === node.accountId)
      return imageNodeSchema.parse({ ...node, automaticAccount, accountId: automaticAccount ? null : node.accountId,
        revision: node.revision + 1, status: 'queued', submittedAt: null, finishedAt: null, error: '', updatedAt: new Date().toISOString(),
        accountSnapshot: automaticAccount || !account ? null : { id: account.id, name: account.name, model: account.model, baseUrl: account.baseUrl, accountGroup: account.accountGroup, protocol: account.protocol ?? 'openai-images' } })
    })
    authorize()
    for (const node of nodes) this.assertVersionSource(node, true)
    this.repository.saveNodes(queued, nodes.map((node) => node.revision), submission)
    if (submission) for (const node of queued) this.submissionAuthorizations.set(node.id, authorize)
    this.schedule()
    return queued
  }
  async cancelQueued(raw: ImageNodeAction) {
    const node = this.current(imageNodeActionSchema.parse(raw))
    if (node.status !== 'queued') throw new Error('仅可撤回尚未提交的排队任务')
    this.submissionAuthorizations.delete(node.id)
    return this.change(node, { status: 'draft', accountSnapshot: null, error: '' })
  }
  async resolveUnknown(raw: ImageNodeAction & { confirmed: true }) {
    const input = imageNodeActionSchema.extend({ confirmed: z.literal(true) }).parse(raw)
    const node = this.current(input)
    if (node.status !== 'acceptance_unknown') throw new Error('仅用于人工核实受理不明任务')
    const saved = this.change(node, { status: 'resolved', finishedAt: new Date().toISOString(), error: '用户已确认远端请求结束；本地解除占用，未重新生成' })
    this.schedule()
    return saved
  }
  async resumeAccount(id: string) {
    const record = this.repository.accounts().find((item) => item.account.id === id)
    if (!record) throw new Error('账号不存在')
    for (const item of this.repository.accounts().filter((other) => other.account.accountGroup === record.account.accountGroup)) {
      this.repository.saveAccount({ ...item, account: { ...item.account, stopped: false, revision: item.account.revision + 1 } }, item.account.revision)
    }
    this.schedule()
    return this.accounts()
  }
  async review(raw: ReviewImageNode) {
    const input = reviewImageNodeSchema.parse(raw)
    const node = this.current(input)
    if (node.status !== 'saved' || !node.assetId) throw new Error('仅可审核已归档图片')
    const saved = this.change(node, { review: input.review })
    this.schedule()
    return saved
  }
  private async prepareOutputRecovery(raw: ImageNodeAction, authorize: () => void) {
    const input = imageNodeActionSchema.parse(raw)
    const node = this.current(input)
    if (node.status !== 'output_unavailable' || !this.repository.output(node.id)) throw new Error('没有可恢复的已受理结果，不能重新生图')
    if (this.active.has(node.id)) throw new Error('结果正在归档')
    await this.assets.assertProject(node.projectId)
    this.current(input)
    authorize()
    if (this.active.has(node.id) || this.stopped) throw new Error('结果正在归档或软件正在退出')
    const controller = new AbortController()
    this.active.set(node.id, controller)
    try { this.change(node, { status: 'downloading', finishedAt: null, error: '' }) }
    catch (error) { this.active.delete(node.id); throw error }
    return { node, controller }
  }
  private async finishOutputRecovery(node: ImageNode, controller: AbortController, authorize: () => void) {
    try {
      if (!await this.archive(node.id, controller.signal, authorize)) throw new Error(this.repository.node(node.id).error || '恢复归档被中断')
    } finally { this.active.delete(node.id); this.schedule() }
  }
  async retryOutput(raw: ImageNodeAction) {
    const { node, controller } = await this.prepareOutputRecovery(raw, () => undefined)
    await this.finishOutputRecovery(node, controller, () => undefined)
  }
  async startOutputRecovery(raw: ImageNodeAction, authorize: () => void = () => undefined) {
    const { node, controller } = await this.prepareOutputRecovery(raw, authorize)
    // MCP 只启动已有结果的恢复，立即返回；用查询查看最终结果，不阻塞长连接或重新发起付费 POST。
    void this.finishOutputRecovery(node, controller, authorize).catch(() => undefined)
    return { id: node.id, boardId: node.boardId, revision: this.repository.node(node.id).revision, status: 'downloading' as const }
  }
  restore() {
    for (const node of this.repository.nodes()) {
      if (['preparing', 'generating'].includes(node.status)) this.change(node, { status: 'acceptance_unknown', error: '应用上次退出时请求未确认结束，请核实远端状态，禁止自动重提' })
      else if (node.status === 'downloading') this.change(node, { status: 'output_unavailable', error: '归档被中断，可恢复结果下载，不会重新生图' })
      else if (node.status === 'queued') this.change(node, { status: 'not_submitted', accountSnapshot: null, error: '上次排队尚未提交，请重新确认' })
    }
  }
  stop() { this.stopped = true; for (const controller of this.active.values()) controller.abort() }
  private schedule() {
    if (this.stopped || this.snapshotPaused) return
    this.scheduleRequested = true
    if (this.scheduling) return
    this.scheduling = true
    void (async () => {
      do { this.scheduleRequested = false; await this.pump() } while (this.scheduleRequested && !this.stopped)
    })().catch(() => undefined).finally(() => {
      this.scheduling = false
      if (this.scheduleRequested && !this.stopped) this.schedule()
    })
  }
  private async pump() {
    for (const original of this.repository.nodes().filter((node) => node.status === 'queued')) {
      if (this.stopped || this.snapshotPaused) return
      const nodes = this.repository.nodes()
      if (nodes.filter(occupiesImageCapacity).length >= this.settings().globalConcurrency) return
      try {
        this.submissionAuthorizations.get(original.id)?.()
        await this.assets.assertProject(original.projectId)
        if (this.stopped || this.snapshotPaused) return
        // await 期间可发生撤回、审核变更或账号暂停，真正领取容量前重新读取。
        const node = this.repository.node(original.id)
        if (node.status !== 'queued') continue
        this.assertVersionSource(node, true)
        this.submissionAuthorizations.get(node.id)?.()
        const account = this.selectAccount(node, true)
        if (!account) continue
        this.checkReferences(node.references, node.projectId)
        const key = this.vault.open(account.cipher)
        const controller = new AbortController()
        const selected = account.account
        const pending = this.change(node, { status: 'preparing', accountId: selected.id, error: '', accountSnapshot: {
          id: selected.id, name: selected.name, model: selected.model, baseUrl: selected.baseUrl,
          accountGroup: selected.accountGroup, protocol: selected.protocol ?? 'openai-images'
        } })
        this.active.set(node.id, controller)
        void this.run(pending, account.account, key, controller.signal).catch(() => undefined).finally(() => {
          this.active.delete(node.id); this.submissionAuthorizations.delete(node.id); this.schedule()
        })
      } catch {
        const node = this.repository.node(original.id)
        if (node.status === 'queued') this.change(node, { status: 'not_submitted', accountSnapshot: null, error: '提交前检查失败或 MCP 授权已撤销，请核对参考图片、账号或项目后重新提交' })
        this.submissionAuthorizations.delete(node.id)
      }
    }
  }
  private async run(node: ImageNode, account: ReturnType<ImageGenerationService['accounts']>[number], key: string, signal: AbortSignal) {
    try {
      const paths = node.references.map((ref) => this.assets.path(ref.assetId))
      // 文件编码、地址校验和 DNS 完成后，在实际发送边界持久化，避免本地失败被误记为远端受理不明。
      const output = await this.gateway.generate(account, key, node, paths, signal, () => {
        this.submissionAuthorizations.get(node.id)?.()
        node = this.change(node, { status: 'generating', submittedAt: new Date().toISOString() })
      })
      this.repository.saveOutput(node.id, this.vault.seal(JSON.stringify(output)).cipher)
      node = this.change(this.repository.node(node.id), { status: 'downloading' })
      await this.archive(node.id, signal, this.submissionAuthorizations.get(node.id))
    } catch (error) {
      if (this.stopped) return
      const current = this.repository.node(node.id)
      if (error instanceof ImageHttpError && [401, 403, 429].includes(error.status)) {
        for (const record of this.repository.accounts().filter((item) => item.account.accountGroup === account.accountGroup)) {
          this.repository.saveAccount({ ...record, account: { ...record.account, stopped: true, revision: record.account.revision + 1 } }, record.account.revision)
        }
      }
      const rejected = error instanceof ImageHttpError && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)
      const notSubmitted = current.status === 'preparing' || rejected
      const detail = error instanceof ImageHttpError ? `服务返回 HTTP ${error.status}`
        : error instanceof ImageRequestError ? error.message : '本地准备或响应处理失败（未保留原始异常，避免泄露凭据）'
      this.change(current, { status: notSubmitted ? 'not_submitted' : 'acceptance_unknown', finishedAt: new Date().toISOString(),
        error: `${detail}；${current.status === 'preparing' ? '请求尚未发送' : rejected ? '服务拒绝请求，未自动重试' : '远端结果未确认，可能已计费；未自动重试，请到原服务核实'}` })
    }
  }
  private async archive(id: string, signal: AbortSignal, authorize: () => void = () => undefined) {
    let phase = '读取已保存的生成结果'
    try {
      const cipher = this.repository.output(id)
      if (!cipher) throw new Error('缺少已受理结果')
      const output: ImageOutput = outputSchema.parse(JSON.parse(this.vault.open(cipher)))
      phase = '下载或保存图片文件'
      authorize()
      const file = await this.gateway.saveOutput(id, output, signal, this.repository.node(id).accountSnapshot?.baseUrl ?? null)
      signal.throwIfAborted()
      const node = this.repository.node(id)
      phase = '校验所属项目'
      await this.assets.assertProject(node.projectId)
      signal.throwIfAborted()
      authorize()
      phase = '登记素材库'
      const assetId = this.assets.register(node, file)
      phase = '保存任务完成状态'
      this.change(node, { status: 'saved', assetId, review: 'pending', finishedAt: new Date().toISOString(), error: '' })
      return true
    } catch (error) {
      // 不回显任意异常正文，避免把文件路径、密钥或签名下载链接带入 UI/MCP。
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      const fileErrors: Record<string, string> = { ENOSPC: '磁盘空间不足', EACCES: '文件访问被拒绝', EPERM: '文件操作被系统拒绝', ENOENT: '所需文件或目录不存在', EBUSY: '文件正在被占用', EEXIST: '目标文件已存在，未覆盖' }
      const detail = error instanceof ImageHttpError ? `服务返回 HTTP ${error.status}` : error instanceof ImageRequestError ? error.message : fileErrors[code] ?? '操作未完成，未保留原始异常正文'
      if (!this.stopped) this.change(this.repository.node(id), { status: 'output_unavailable', finishedAt: new Date().toISOString(),
        error: `${phase}失败：${detail}；已有生成结果保留，可重试下载归档，不会重新生图` })
      return false
    }
  }
}

