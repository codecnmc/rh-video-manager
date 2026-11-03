import type { Asset } from '../../../../shared/contracts/assets'
import type { AssemblyVersion } from '../../../../shared/contracts/assembly'
import type { AssemblyExportOptions, AssemblyRenderProgress } from '../../../../shared/contracts/assembly-export'

export interface AssemblyExportMedia {
  get(id: string): Asset
  path(id: string): string
}
export interface AssemblyExportPlan {
  version: AssemblyVersion
  files: Map<string, string>
  options?: AssemblyExportOptions
}
export interface AssemblyRenderer {
  render(plan: AssemblyExportPlan, target: string, signal: AbortSignal, onProgress?: (progress: AssemblyRenderProgress) => void): Promise<void>
}
