import type { ComfyConnectionResult, RoutingSettings } from '../../../../shared/contracts/generation-sources'
export interface GenerationSourcesRepository {
  load(): RoutingSettings
  save(settings: RoutingSettings, expectedRevision: number): void
}
export interface SourceInspector {
  inspect(source: { address: string }): Promise<ComfyConnectionResult>
  hasRunningTasks?(source: { address: string }): Promise<boolean>
}
