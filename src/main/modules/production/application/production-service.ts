import {
  dialoguePlanSchema, generateDialogueSchema, adoptDialogueSchema, productionTakeActionSchema, saveCharacterVoiceSchema, projectVoicesSchema,
  type DialoguePlan, type DialogueTake, type ProductionScope, type GenerateDialogue, type ProductionTakeAction, type AdoptDialogue, type SaveCharacterVoice
} from '../../../../shared/contracts/production'
import { inspectPcmWave } from '../domain/audio'
import type { ProductionAudioFiles, ProductionContext, ProductionLibrary, ProductionRepository, ProductionSpeech } from '../ports/production'

const pending = (take: DialogueTake) => ['queued', 'running', 'cancelling'].includes(take.status)

export class ProductionService {
  private readonly controllers = new Map<string, AbortController>()
  private readonly queue: DialogueTake[] = []
  private active: DialogueTake | undefined
  private closed = false
  constructor(private readonly repository: ProductionRepository, private readonly speech: ProductionSpeech,
    private readonly context: ProductionContext, private readonly files: ProductionAudioFiles,
    private readonly library: ProductionLibrary, private readonly id: () => string) {
    // 重启只恢复历史，不重新提交可能已受理的模型请求。
    repository.interruptPending()
  }
  capabilities() { return this.speech.speechCapabilities() }
  hasStorageActivity(): boolean { return this.controllers.size > 0 || this.queue.length > 0 || this.active !== undefined }
  async listTasks() {
    const scopes = new Set((await this.context.scopes()).map((scope) => `${scope.projectId}/${scope.draftId}`))
    return this.repository.allTakes().filter((take) => scopes.has(`${take.projectId}/${take.draftId}`))
  }
  async load(scope: ProductionScope) {
    await this.context.draft(scope)
    return { plan: this.repository.plan(scope), takes: this.repository.takes(scope), voices: this.repository.projectVoices(scope.projectId) }
  }
  async saveCharacterVoice(input: SaveCharacterVoice) {
    const parsed = saveCharacterVoiceSchema.parse(input)
    await this.context.draft(parsed)
    const current = this.repository.projectVoices(parsed.projectId)
    if (current.revision !== parsed.revision) throw new Error('项目音色绑定已更新，请重新载入')
    const bindings = [...current.bindings.filter((item) => item.character !== parsed.binding.character), parsed.binding]
    return this.repository.saveProjectVoices(projectVoicesSchema.parse({ ...current, bindings }))
  }
  async save(input: DialoguePlan) {
    const parsed = dialoguePlanSchema.parse(input)
    await this.context.draft(parsed)
    return this.repository.savePlan(parsed)
  }
  async generate(input: GenerateDialogue, cloudConsentKey?: string) {
    const parsed = generateDialogueSchema.parse(input)
    const draft = await this.context.draft(parsed)
    if (this.closed) throw new Error('生产任务正在关闭')
    const plan = this.repository.plan(parsed)
    if (plan.revision !== parsed.revision) throw new Error('台词配置已更新，请重新载入')
    if (!plan.enabled) throw new Error('请先启用并保存台词生产步骤')
    const line = plan.lines.find((item) => item.id === parsed.lineId)
    if (!line?.text.trim() || !line.voiceId || !line.providerId || !line.extensionId) throw new Error('请填写台词、引擎和音色')
    const capability = this.capabilities().find((item) => item.extensionId === line.extensionId && item.provider.id === line.providerId)
    if (!capability?.available) throw new Error(capability?.reason ?? '语音引擎不可用')
    if (capability.provider.runtime === 'cloud' && cloudConsentKey !== capability.configurationKey) throw new Error('云端调用尚未确认，或确认后的插件配置已变化')
    if (line.text.length > (capability.provider.maxTextLength ?? 5000)) throw new Error('台词超过当前引擎的单次长度限制')
    if (line.delivery.trim() && !capability.provider.capabilities.emotion) throw new Error('所选引擎不支持语气描述，请保留原文并更换引擎，或清空本次语气描述')
    if (this.repository.takes(parsed).some((take) => take.line.id === line.id && pending(take))) throw new Error('这句台词已有待完成任务')
    if (this.queue.length >= 200) throw new Error('语音任务队列已满')
    const take: DialogueTake = { id: this.id(), projectId: parsed.projectId, draftId: parsed.draftId, planRevision: plan.revision,
      line: structuredClone(line), sourcePrompt: draft.prompt, providerVersion: capability.version, runtime: capability.provider.runtime,
      configurationKey: capability.configurationKey, providerSettings: { ...capability.settings },
      status: 'queued', createdAt: new Date().toISOString(), finishedAt: null, error: null, assetId: null, durationMs: null, adopted: false }
    this.repository.saveTake(take)
    this.queue.push(take)
    this.pump()
    return take
  }
  private pump(): void {
    // 首个本地测试版全局单路语音，避免 4GB 显存/内存超配；不占用视频任务队列。
    if (this.closed || this.active) return
    const take = this.queue.shift()
    if (!take) return
    this.active = take
    const controller = new AbortController()
    this.controllers.set(take.id, controller)
    take.status = 'running'
    this.repository.saveTake(take)
    void this.run(take, controller).finally(() => {
      this.controllers.delete(take.id)
      this.active = undefined
      this.pump()
    }).catch(() => undefined)
  }
  private async run(take: DialogueTake, controller: AbortController): Promise<void> {
    try {
      await this.context.draft(take)
      const capability = this.capabilities().find((item) => item.extensionId === take.line.extensionId && item.provider.id === take.line.providerId)
      if (!capability?.available || capability.version !== take.providerVersion || capability.configurationKey !== take.configurationKey) throw new Error('引擎已停用、未配置、设置或版本变化，请检查后手动重新生成')
      const audio = await this.speech.synthesize(take.line.extensionId, take.line.providerId, {
        text: take.line.text, voiceId: take.line.voiceId, language: take.line.language,
        delivery: { description: take.line.delivery, speed: take.line.speed }
      }, controller.signal, take.configurationKey)
      if (controller.signal.aborted) throw new Error('生成已取消')
      if (audio.format !== 'wav') throw new Error('当前生产导入仅支持 PCM16 WAV，请调整插件输出格式')
      const info = inspectPcmWave(audio.audio)
      if (info.sampleRate !== audio.sampleRate || Math.abs(info.durationMs - audio.durationMs) > 100) throw new Error('插件返回的音频信息与文件不一致')
      const path = await this.files.stage(take.id, audio.audio)
      await this.context.draft(take)
      if (controller.signal.aborted) throw new Error('生成已取消')
      take.assetId = await this.library.importAudio(take, path, `${take.line.character || '台词'}-${take.id.slice(0, 8)}`, take.line.text)
      if (controller.signal.aborted) throw new Error('生成已取消，已收到的音频保留')
      take.durationMs = info.durationMs
      take.status = 'succeeded'
    } catch (failure) {
      take.status = controller.signal.aborted ? (take.runtime === 'cloud' ? 'interrupted' : 'cancelled') : 'failed'
      take.error = take.runtime === 'cloud' ? '云端请求未确认完成，可能已受理或计费；请核对服务端，不会自动重试' :
        controller.signal.aborted ? '本地生成已取消' : failure instanceof Error ? failure.message : '生成失败'
    } finally {
      await this.files.discard(take.id).catch(() => undefined)
      take.finishedAt = new Date().toISOString()
      if (!this.closed) this.repository.saveTake(take)
    }
  }
  async cancel(input: ProductionTakeAction) {
    const parsed = productionTakeActionSchema.parse(input)
    await this.context.draft(parsed)
    const index = this.queue.findIndex((take) => take.id === parsed.takeId && take.draftId === parsed.draftId)
    if (index >= 0) {
      const take = this.queue.splice(index, 1)[0]!
      take.status = 'cancelled'; take.finishedAt = new Date().toISOString()
      this.repository.saveTake(take)
    } else if (this.active?.id === parsed.takeId && this.active.draftId === parsed.draftId && this.active.status === 'running') {
      this.active.status = 'cancelling'
      this.repository.saveTake(this.active)
      this.controllers.get(parsed.takeId)?.abort()
    }
  }
  async adopt(input: AdoptDialogue) {
    const parsed = adoptDialogueSchema.parse(input)
    const draft = await this.context.draft(parsed)
    const plan = this.repository.plan(parsed)
    const take = this.repository.takes(parsed).find((item) => item.id === parsed.takeId)
    if (!take || take.status !== 'succeeded' || !take.assetId) throw new Error('候选音频尚未成功生成')
    if (plan.revision !== parsed.revision || take.planRevision !== plan.revision || take.sourcePrompt !== draft.prompt) throw new Error('候选音频来自旧版输入，请重新生成后再采用')
    const capability = this.capabilities().find((item) => item.extensionId === take.line.extensionId && item.provider.id === take.line.providerId)
    if (capability?.configurationKey !== take.configurationKey || capability.version !== take.providerVersion) throw new Error('候选音频的插件配置或版本已变化，请重新生成')
    this.library.ensureAudio(take.assetId)
    this.repository.adopt(take)
  }
  hasPending(projectId: string, draftId?: string) {
    return [...this.queue, ...(this.active ? [this.active] : [])].some((take) => take.projectId === projectId && (!draftId || take.draftId === draftId))
  }
  stop(): void {
    this.closed = true
    for (const controller of this.controllers.values()) controller.abort()
    this.queue.length = 0
    this.repository.interruptPending()
  }
}
