import { z } from 'zod'

export const extensionApiVersion = '1.0.0'
const segment = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const settingKey = segment.refine((value) => !['constructor', 'prototype', '__proto__'].includes(value), '配置键不能使用对象保留名称')
export const extensionIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/)
const contributionId = z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/)
const permissionSchema = z.enum(['network.local', 'network.cloud', 'models.local', 'audio.reference', 'assets.selection'])
const storageTable = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const extensionStorageManifestSchema = z.strictObject({
  version: z.number().int().min(1).max(1000000),
  tables: z.array(storageTable).min(1).max(30).refine((tables) => new Set(tables).size === tables.length, '插件数据表不能重名')
})
export type ExtensionStorageManifest = z.infer<typeof extensionStorageManifestSchema>
export const extensionStorageValueSchema = z.json().refine((value) => JSON.stringify(value).length <= 65536, '插件记录超过大小限制')
export type ExtensionStorageValue = z.infer<typeof extensionStorageValueSchema>
const storageAddress = { table: storageTable, key: z.string().min(1).max(200) }
export const extensionStorageOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('get'), ...storageAddress }),
  z.strictObject({ operation: z.literal('set'), ...storageAddress, value: extensionStorageValueSchema }),
  z.strictObject({ operation: z.literal('delete'), ...storageAddress }),
  z.strictObject({ operation: z.literal('list'), table: storageTable, after: z.string().max(200).optional(), limit: z.number().int().min(1).max(100) })
])
export type ExtensionStorageOperation = z.infer<typeof extensionStorageOperationSchema>
const settingSchema = z.strictObject({
  key: settingKey,
  title: z.string().trim().min(1).max(80),
  type: z.enum(['string', 'boolean', 'number', 'secret']),
  required: z.boolean().default(false)
})

export const extensionManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  publisher: segment,
  name: segment,
  displayName: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).max(40),
  engines: z.strictObject({ videoWorkbench: z.literal('^1.0.0') }),
  main: z.string().regex(/^\.\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.cjs$/).max(200),
  activationEvents: z.array(z.enum(['onCommand', 'onSpeech'])).max(2),
  permissions: z.array(permissionSchema).max(5),
  storage: extensionStorageManifestSchema.optional(),
  contributes: z.strictObject({
    pages: z.array(z.strictObject({
      id: contributionId, title: z.string().trim().min(1).max(60),
      inputLabel: z.string().trim().min(1).max(100).optional(),
      acceptsAssets: z.boolean().optional()
    })).max(10).optional(),
    commands: z.array(z.strictObject({ id: contributionId, title: z.string().trim().min(1).max(100),
      contexts: z.array(z.enum(['draft', 'script'])).min(1).max(2).optional() })).max(30).default([]),
    views: z.array(z.strictObject({ id: contributionId, title: z.string().trim().min(1).max(100),
      location: z.enum(['draft', 'script']), command: contributionId })).max(20).optional(),
    speechProviders: z.array(z.strictObject({
      id: contributionId,
      name: z.string().trim().min(1).max(100),
      runtime: z.enum(['local', 'cloud']),
      maxTextLength: z.number().int().min(1).max(5000).optional(),
      capabilities: z.strictObject({ presetVoices: z.boolean(), voiceCloning: z.boolean(), emotion: z.boolean() })
    })).max(10).default([]),
    configuration: z.array(settingSchema).max(30).default([])
  })
})

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>
export type ExtensionSettingValue = string | boolean | number
export const extensionSettingsSchema = z.record(z.string().max(64), z.union([z.string().max(2000), z.boolean(), z.number().finite()]))
export const extensionActionSchema = z.strictObject({ id: extensionIdSchema })
export const extensionEnabledSchema = extensionActionSchema.extend({ enabled: z.boolean() })
export const saveExtensionSettingsSchema = extensionActionSchema.extend({ values: extensionSettingsSchema })
export const saveExtensionSecretSchema = extensionActionSchema.extend({ key: settingKey, value: z.string().max(4000) })
export const extensionCommandSchema = extensionActionSchema.extend({ command: contributionId })
export const extensionVoicesRequestSchema = extensionActionSchema.extend({ providerId: contributionId })
export const extensionDocumentContextSchema = z.strictObject({
  kind: z.enum(['draft', 'script']), projectId: z.string().uuid(), entityId: z.string().uuid(), text: z.string().max(200000)
})
export const extensionContextCommandSchema = extensionCommandSchema.extend({ context: extensionDocumentContextSchema })
export const extensionProposalSchema = z.strictObject({ title: z.string().min(1).max(100), text: z.string().max(200000) }).nullable()
export type ExtensionDocumentContext = z.infer<typeof extensionDocumentContextSchema>
export type ExtensionContextCommand = z.infer<typeof extensionContextCommandSchema>
export type ExtensionProposal = z.infer<typeof extensionProposalSchema>
export const extensionPageRequestSchema = z.strictObject({
  id: extensionIdSchema, pageId: contributionId, projectId: z.string().uuid().nullable(),
  text: z.string().max(200000), assetIds: z.array(z.string().uuid()).max(20)
    .refine((ids) => new Set(ids).size === ids.length, '素材引用不能重复')
})
export const extensionPageAssetSchema = z.strictObject({
  id: z.string().uuid(), name: z.string().max(200), kind: z.enum(['image', 'video', 'audio', 'prompt']),
  prompt: z.string().max(200000), notes: z.string().max(200000), tags: z.array(z.string().max(100)).max(100)
})
export const extensionPageContextSchema = z.strictObject({
  projectId: z.string().uuid().nullable(), text: z.string().max(200000), assets: z.array(extensionPageAssetSchema).max(20)
})
export type ExtensionPageRequest = z.infer<typeof extensionPageRequestSchema>
export type ExtensionPageContext = z.infer<typeof extensionPageContextSchema>
export const speechVoiceSchema = z.strictObject({
  id: z.string().min(1).max(200), name: z.string().min(1).max(100),
  language: z.string().max(40), source: z.enum(['preset', 'cloned'])
})
export const speechVoicesSchema = z.array(speechVoiceSchema).max(1000)
export type SpeechVoice = z.infer<typeof speechVoiceSchema>

export const speechSynthesisRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(5000), voiceId: z.string().min(1).max(200),
  language: z.string().min(1).max(40),
  delivery: z.strictObject({ description: z.string().max(1000), speed: z.number().min(0.5).max(2).optional() }),
  targetDurationMs: z.number().int().min(100).max(600000).optional()
})
export type SpeechSynthesisRequest = z.infer<typeof speechSynthesisRequestSchema>
export const speechAudioSchema = z.strictObject({
  audio: z.instanceof(Uint8Array).refine((data) => data.byteLength > 44 && data.byteLength <= 20 * 1024 * 1024),
  format: z.enum(['wav', 'mp3']), durationMs: z.number().positive().max(3600000),
  sampleRate: z.number().int().min(8000).max(192000)
})
export type SpeechAudio = z.infer<typeof speechAudioSchema>
export interface SpeechCapability {
  extensionId: string
  extensionName: string
  version: string
  configurationKey: string
  settings: Record<string, ExtensionSettingValue>
  provider: ExtensionManifest['contributes']['speechProviders'][number]
  available: boolean
  reason: string | null
}

export interface InstalledExtension {
  id: string
  manifest: ExtensionManifest
  enabled: boolean
  installedAt: string
  settings: Record<string, ExtensionSettingValue>
  configuredSecrets: string[]
  configured: boolean
  status: 'disabled' | 'idle' | 'activating' | 'active' | 'error'
  error: string | null
}

export type SaveExtensionSettings = z.infer<typeof saveExtensionSettingsSchema>
export type SaveExtensionSecret = z.infer<typeof saveExtensionSecretSchema>
