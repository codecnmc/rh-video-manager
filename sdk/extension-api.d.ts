export interface Disposable { dispose(): void | Promise<void> }
export interface SpeechVoice {
  id: string
  name: string
  language: string
  source: 'preset' | 'cloned'
}
export interface SpeechSynthesisRequest {
  text: string
  voiceId: string
  language: string
  delivery: { description: string; speed?: number | undefined }
  targetDurationMs?: number | undefined
}
export interface SpeechAudio {
  audio: Uint8Array
  format: 'wav' | 'mp3'
  durationMs: number
  sampleRate: number
}
export interface VoiceCloneRequest {
  name: string
  referenceAudio: Uint8Array
  format: 'wav' | 'mp3'
  transcript?: string
  consentConfirmed: true
}
export interface SpeechProvider {
  listVoices(signal: AbortSignal): Promise<SpeechVoice[]>
  synthesize(request: SpeechSynthesisRequest, signal: AbortSignal): Promise<SpeechAudio>
  cloneVoice?(request: VoiceCloneRequest, signal: AbortSignal): Promise<SpeechVoice>
}
export interface DocumentContext {
  readonly kind: 'draft' | 'script'
  readonly projectId: string
  readonly entityId: string
  readonly text: string
}
export interface TextProposal { title: string; text: string }
export type CommandHandler = (signal: AbortSignal, document?: DocumentContext) => void | TextProposal | Promise<void | TextProposal>
export interface PageContext {
  readonly projectId: string | null
  readonly text: string
  readonly assets: ReadonlyArray<{
    id: string; name: string; kind: 'image' | 'video' | 'audio' | 'prompt'
    prompt: string; notes: string; tags: string[]
  }>
}
export type PageHandler = (signal: AbortSignal, input: PageContext) => TextProposal | null | Promise<TextProposal | null>
export type StorageValue = string | number | boolean | null | StorageValue[] | { [key: string]: StorageValue }
export interface ExtensionStorage {
  get(table: string, key: string): Promise<{ key: string; value: StorageValue } | null>
  set(table: string, key: string, value: StorageValue): Promise<void>
  delete(table: string, key: string): Promise<void>
  list(table: string, options?: { after?: string; limit?: number }): Promise<{ key: string; value: StorageValue }[]>
}
export interface ExtensionContext {
  readonly extensionId: string
  readonly apiVersion: '1.0.0'
  /** Host-owned writable data directory; separate from the immutable package. */
  readonly storagePath: string
  /** Host-owned SQLite record tables declared in manifest.storage; no SQL or database path. */
  readonly storage: ExtensionStorage
  /** Opens only this extension's host-assigned output directory. */
  openStorageDirectory(): Promise<void>
  readonly configuration: Readonly<Record<string, string | number | boolean>>
  readonly secrets: { get(key: string): string | undefined }
  readonly subscriptions: Disposable[]
  registerCommand(id: string, handler: CommandHandler): Disposable
  /** Host-rendered independent page. Runs only after explicit user confirmation. */
  registerPage(id: string, handler: PageHandler): Disposable
  registerSpeechProvider(id: string, provider: SpeechProvider): Disposable
}
export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
