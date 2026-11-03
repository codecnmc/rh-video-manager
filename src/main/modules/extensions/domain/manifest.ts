import { extensionManifestSchema, type ExtensionManifest, type ExtensionSettingValue } from '../../../../shared/contracts/extensions'

export function extensionId(manifest: ExtensionManifest): string { return `${manifest.publisher}.${manifest.name}` }

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  const manifest = extensionManifestSchema.parse(input)
  const id = extensionId(manifest)
  const contributions = [...manifest.contributes.commands, ...manifest.contributes.speechProviders, ...(manifest.contributes.views ?? []), ...(manifest.contributes.pages ?? [])]
  if (new Set(contributions.map((item) => item.id)).size !== contributions.length ||
    contributions.some((item) => !item.id.startsWith(`${id}.`))) throw new Error('插件能力 ID 必须唯一并使用插件 ID 前缀')
  if (new Set(manifest.contributes.configuration.map((item) => item.key)).size !== manifest.contributes.configuration.length) throw new Error('插件配置项不能重名')
  if (new Set(manifest.activationEvents).size !== manifest.activationEvents.length || new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error('插件激活事件或权限不能重复')
  if (manifest.contributes.commands.length && !manifest.activationEvents.includes('onCommand')) throw new Error('命令需要声明 onCommand 激活事件')
  if (manifest.contributes.pages?.length && !manifest.activationEvents.includes('onCommand')) throw new Error('独立页面需要声明 onCommand 激活事件')
  if (manifest.contributes.pages?.some((page) => page.acceptsAssets) && !manifest.permissions.includes('assets.selection')) throw new Error('页面引用素材需要声明 assets.selection')
  if (manifest.contributes.speechProviders.length && !manifest.activationEvents.includes('onSpeech')) throw new Error('语音能力需要声明 onSpeech 激活事件')
  for (const view of manifest.contributes.views ?? []) {
    if (!manifest.contributes.commands.some((command) => command.id === view.command && command.contexts?.includes(view.location))) throw new Error('插件视图必须关联同一上下文的已声明命令')
  }
  for (const provider of manifest.contributes.speechProviders) {
    if (provider.runtime === 'local' ? !manifest.permissions.includes('network.local') && !manifest.permissions.includes('models.local')
      : !manifest.permissions.includes('network.cloud')) throw new Error('语音引擎需要声明对应的模型或网络权限')
    if (provider.capabilities.voiceCloning && !manifest.permissions.includes('audio.reference')) throw new Error('音色克隆需要声明参考音频权限')
  }
  return manifest
}

export function validateExtensionSettings(manifest: ExtensionManifest, values: Record<string, ExtensionSettingValue>): void {
  for (const [key, value] of Object.entries(values)) {
    const field = manifest.contributes.configuration.find((item) => item.key === key)
    if (!field || field.type === 'secret' || typeof value !== field.type) throw new Error('插件配置类型不正确；密钥必须通过专用入口保存')
  }
}

export function extensionConfigured(manifest: ExtensionManifest, settings: Record<string, ExtensionSettingValue>, secrets: string[]): boolean {
  return manifest.contributes.configuration.filter((field) => field.required).every((field) =>
    field.type === 'secret' ? secrets.includes(field.key) : settings[field.key] !== undefined && settings[field.key] !== '')
}
