import type { ExtensionManifest, ExtensionSettingValue, SpeechSynthesisRequest, ExtensionDocumentContext, ExtensionPageContext } from '../../../../shared/contracts/extensions'

export interface ExtensionRecord {
  id: string
  manifest: ExtensionManifest
  packageKey: string
  digest: string
  enabled: boolean
  installedAt: string
  settings: Record<string, ExtensionSettingValue>
  configurationRevision?: number
}

export interface ExtensionRepository {
  list(): ExtensionRecord[]
  save(record: ExtensionRecord): void
  remove(id: string): void
  secretKeys(id: string): string[]
  readSecrets(id: string): Record<string, Uint8Array>
  saveSecret(id: string, key: string, cipher: Uint8Array | null, configurationRevision?: number): void
}

export interface ExtensionPackages {
  stage(directory: string): Promise<{ manifest: ExtensionManifest; packageKey: string; digest: string }>
  verify(record: ExtensionRecord): Promise<void>
  discard(packageKey: string): Promise<void>
}

export interface ExtensionVault {
  encrypt(value: string): Uint8Array
  decrypt(cipher: Uint8Array): string
}

export interface ExtensionHost {
  start(record: ExtensionRecord, secrets: Record<string, string>): Promise<void>
  command(id: string, command: string): Promise<void>
  contextCommand(id: string, command: string, context: ExtensionDocumentContext): Promise<unknown>
  page?(id: string, pageId: string, context: ExtensionPageContext): Promise<unknown>
  voices(id: string, providerId: string): Promise<unknown>
  synthesize(id: string, providerId: string, request: SpeechSynthesisRequest, signal: AbortSignal): Promise<unknown>
  stop(id: string): void
  stopAll(): void
  state(id: string): { status: 'idle' | 'activating' | 'active' | 'error'; error: string | null }
}
