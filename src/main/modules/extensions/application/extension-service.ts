import {
  saveExtensionSettingsSchema, saveExtensionSecretSchema, speechVoicesSchema,
  speechSynthesisRequestSchema, speechAudioSchema,
  extensionContextCommandSchema, extensionProposalSchema, type ExtensionContextCommand,
  extensionPageContextSchema, type ExtensionPageContext,
  type InstalledExtension, type SaveExtensionSettings, type SaveExtensionSecret, type SpeechCapability, type SpeechSynthesisRequest
} from '../../../../shared/contracts/extensions'
import { extensionConfigured, extensionId, validateExtensionSettings } from '../domain/manifest'
import type { ExtensionHost, ExtensionPackages, ExtensionRecord, ExtensionRepository, ExtensionVault } from '../ports/extensions'

export class ExtensionService {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly activating = new Map<string, Promise<void>>()
  private closed = false
  constructor(private readonly repository: ExtensionRepository, private readonly packages: ExtensionPackages,
    private readonly host: ExtensionHost, private readonly vault: ExtensionVault) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.closed) throw new Error('插件系统正在关闭')
      return action()
    })
    this.queue = next.catch(() => undefined)
    return next
  }
  private get(id: string): ExtensionRecord {
    const record = this.repository.list().find((item) => item.id === id)
    if (!record) throw new Error('插件未安装')
    return record
  }
  list(): InstalledExtension[] {
    return this.repository.list().map((record) => ({ id: record.id, manifest: record.manifest,
      enabled: record.enabled, installedAt: record.installedAt, settings: record.settings,
      configuredSecrets: this.repository.secretKeys(record.id),
      configured: extensionConfigured(record.manifest, record.settings, this.repository.secretKeys(record.id)),
      ...(record.enabled ? this.host.state(record.id) : { status: 'disabled' as const, error: null }) }))
  }
  install(directory: string, confirm: (manifest: ExtensionRecord['manifest']) => Promise<boolean>): Promise<InstalledExtension[]> {
    return this.serial(async () => {
      const staged = await this.packages.stage(directory)
      let retained = false
      try {
        const id = extensionId(staged.manifest)
        if (this.repository.list().some((item) => item.id === id)) throw new Error('插件已安装，请先卸载旧版本再安装；生成素材不会删除')
        if (!await confirm(staged.manifest)) return this.list()
        if (this.closed) throw new Error('插件系统正在关闭')
        this.repository.save({ ...staged, id, enabled: false, installedAt: new Date().toISOString(), settings: {} })
        retained = true
        return this.list()
      } finally {
        if (!retained) await this.packages.discard(staged.packageKey)
      }
    })
  }
  setEnabled(id: string, enabled: boolean): Promise<InstalledExtension[]> {
    return this.serial(async () => {
      const record = this.get(id)
      if (enabled) await this.packages.verify(record)
      else this.host.stop(id)
      // 启用不执行插件，不自动联网或加载模型；第一次显式调用才激活。
      this.repository.save({ ...record, enabled })
      return this.list()
    })
  }
  remove(id: string): Promise<InstalledExtension[]> {
    return this.serial(async () => {
      const record = this.get(id)
      this.host.stop(id)
      // 先移除登记，包目录保留为可回收存档，不触碰素材和插件生成文件。
      this.repository.remove(record.id)
      return this.list()
    })
  }
  saveSettings(input: SaveExtensionSettings): Promise<InstalledExtension[]> {
    return this.serial(async () => {
      const parsed = saveExtensionSettingsSchema.parse(input)
      const record = this.get(parsed.id)
      validateExtensionSettings(record.manifest, parsed.values)
      this.host.stop(record.id)
      this.repository.save({ ...record, settings: parsed.values, configurationRevision: (record.configurationRevision ?? 0) + 1 })
      return this.list()
    })
  }
  saveSecret(input: SaveExtensionSecret): Promise<InstalledExtension[]> {
    return this.serial(async () => {
      const parsed = saveExtensionSecretSchema.parse(input)
      const record = this.get(parsed.id)
      if (!record.manifest.contributes.configuration.some((field) => field.key === parsed.key && field.type === 'secret')) throw new Error('未声明的插件密钥')
      const cipher = parsed.value ? this.vault.encrypt(parsed.value) : null
      this.host.stop(record.id)
      this.repository.saveSecret(record.id, parsed.key, cipher, (record.configurationRevision ?? 0) + 1)
      return this.list()
    })
  }
  private activate(id: string): Promise<void> {
    const pending = this.activating.get(id)
    if (pending) return pending
    const operation = this.serial(async () => {
      const record = this.get(id)
      if (!record.enabled) throw new Error('插件已停用')
      if (!extensionConfigured(record.manifest, record.settings, this.repository.secretKeys(id))) throw new Error('插件尚未配置，请填写必填设置')
      if (this.host.state(id).status === 'active') return
      await this.packages.verify(record)
      if (this.closed) throw new Error('插件系统正在关闭')
      const secrets = Object.fromEntries(Object.entries(this.repository.readSecrets(id)).map(([key, cipher]) => [key, this.vault.decrypt(cipher)]))
      await this.host.start(record, secrets)
    })
    this.activating.set(id, operation)
    void operation.finally(() => this.activating.delete(id)).catch(() => undefined)
    return operation
  }
  async runCommand(id: string, command: string): Promise<void> {
    const contribution = this.get(id).manifest.contributes.commands.find((item) => item.id === command)
    if (!contribution) throw new Error('插件命令未声明')
    if (contribution.contexts?.length) throw new Error('请从对应的剧本或草稿文档调用此工具')
    await this.activate(id)
    if (!this.get(id).enabled) throw new Error('插件已停用')
    await this.host.command(id, command)
  }
  async listVoices(id: string, providerId: string) {
    if (!this.get(id).manifest.contributes.speechProviders.some((item) => item.id === providerId)) throw new Error('语音引擎未声明')
    await this.activate(id)
    if (!this.get(id).enabled) throw new Error('插件已停用')
    return speechVoicesSchema.parse(await this.host.voices(id, providerId))
  }
  async runContextCommand(input: ExtensionContextCommand) {
    const parsed = extensionContextCommandSchema.parse(input)
    const command = this.get(parsed.id).manifest.contributes.commands.find((item) => item.id === parsed.command)
    if (!command?.contexts?.includes(parsed.context.kind)) throw new Error('插件命令不适用于当前文档')
    await this.activate(parsed.id)
    if (!this.get(parsed.id).enabled) throw new Error('插件已停用')
    return extensionProposalSchema.parse(await this.host.contextCommand(parsed.id, parsed.command, parsed.context))
  }
  async runPage(id: string, pageId: string, input: ExtensionPageContext) {
    const context = extensionPageContextSchema.parse(input)
    const record = this.get(id)
    const page = record.manifest.contributes.pages?.find((item) => item.id === pageId)
    if (!page) throw new Error('插件页面未声明')
    if (context.assets.length && (!page.acceptsAssets || !record.manifest.permissions.includes('assets.selection'))) throw new Error('此页面未声明素材引用权限')
    await this.activate(id)
    if (!this.get(id).enabled) throw new Error('插件已停用')
    if (!this.host.page) throw new Error('当前插件宿主不支持独立页面')
    return extensionProposalSchema.parse(await this.host.page(id, pageId, context))
  }
  speechCapabilities(): SpeechCapability[] {
    return this.list().flatMap((extension) => extension.manifest.contributes.speechProviders.map((provider) => ({
      extensionId: extension.id, extensionName: extension.manifest.displayName, version: extension.manifest.version, provider,
      configurationKey: this.configurationKey(extension.id),
      settings: { ...extension.settings },
      available: extension.enabled && extension.configured,
      reason: !extension.enabled ? '插件已停用' : !extension.configured ? '插件尚未配置' : null
    })))
  }
  private configurationKey(id: string): string {
    const record = this.get(id)
    return `${record.installedAt}/${record.digest}/${record.configurationRevision ?? 0}`
  }
  async synthesize(id: string, providerId: string, input: SpeechSynthesisRequest, signal: AbortSignal, expectedConfigurationKey?: string) {
    const request = speechSynthesisRequestSchema.parse(input)
    const provider = this.get(id).manifest.contributes.speechProviders.find((item) => item.id === providerId)
    if (!provider) throw new Error('语音引擎未声明')
    if (request.text.length > (provider.maxTextLength ?? 5000)) throw new Error('台词超过当前引擎的单次长度限制')
    if (request.delivery.description.trim() && !provider.capabilities.emotion) throw new Error('当前引擎不支持语气控制，请更换引擎或清空本次语气描述')
    if (request.targetDurationMs !== undefined) throw new Error('当前版本尚未接入时长拟合能力')
    if (signal.aborted) throw new Error('生成已取消')
    if (expectedConfigurationKey !== undefined && this.configurationKey(id) !== expectedConfigurationKey) throw new Error('插件配置已变化，请重新生成')
    await this.activate(id)
    if (signal.aborted || !this.get(id).enabled) throw new Error('生成已取消或插件已停用')
    // 激活与设置保存共用队列，等待激活后仍需拒绝被替换的模型/密钥配置。
    if (expectedConfigurationKey !== undefined && this.configurationKey(id) !== expectedConfigurationKey) throw new Error('插件配置已变化，请重新生成')
    return speechAudioSchema.parse(await this.host.synthesize(id, providerId, request, signal))
  }
  stopAll(): void { this.closed = true; this.host.stopAll() }
}
