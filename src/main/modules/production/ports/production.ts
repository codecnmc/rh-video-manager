import type { DialoguePlan, DialogueTake, ProductionScope, ProjectVoices } from '../../../../shared/contracts/production'
import type { SpeechAudio, SpeechCapability, SpeechSynthesisRequest } from '../../../../shared/contracts/extensions'

export interface ProductionRepository {
  plan(scope: ProductionScope): DialoguePlan
  savePlan(plan: DialoguePlan): DialoguePlan
  takes(scope: ProductionScope): DialogueTake[]
  allTakes(): DialogueTake[]
  saveTake(take: DialogueTake): void
  adopt(take: DialogueTake): void
  interruptPending(): void
  projectVoices(projectId: string): ProjectVoices
  saveProjectVoices(voices: ProjectVoices): ProjectVoices
}
export interface ProductionSpeech {
  speechCapabilities(): SpeechCapability[]
  synthesize(id: string, providerId: string, request: SpeechSynthesisRequest, signal: AbortSignal, expectedConfigurationKey?: string): Promise<SpeechAudio>
}
export interface ProductionContext {
  draft(scope: ProductionScope): Promise<{ prompt: string }>
  scopes(): Promise<ProductionScope[]>
}
export interface ProductionAudioFiles {
  stage(id: string, audio: Uint8Array): Promise<string>
  discard(id: string): Promise<void>
}
export interface ProductionLibrary {
  importAudio(scope: ProductionScope, path: string, name: string, notes: string): Promise<string>
  ensureAudio(id: string): void
}
