import { exportAssemblySchema, type ExportAssembly } from '../../../../shared/contracts/assembly'
import type { AssemblyService } from './assembly-service'
import type { AssemblyExportMedia, AssemblyExportPlan, AssemblyRenderer } from '../ports/assembly-export'
import type { AssemblyRenderProgress } from '../../../../shared/contracts/assembly-export'

export class AssemblyExportService {
  private active = false
  constructor(private readonly assembly: AssemblyService, private readonly media: AssemblyExportMedia) {}
  hasActivity(): boolean { return this.active }

  prepare(input: ExportAssembly): AssemblyExportPlan {
    const parsed = exportAssemblySchema.parse(input)
    const document = this.assembly.get(parsed.id, parsed.projectId)
    if (document.revision !== parsed.expectedRevision) throw new Error('排片工程已更新，请载入最新版本后再导出')
    const version = document.versions.find((item) => item.id === parsed.versionId)
    if (!version?.clips.length) throw new Error('当前版本没有视频片段，不能导出')
    if (!parsed.allowPendingSounds && version.sounds.some((sound) => sound.state === 'missing' || sound.state === 'review')) {
      throw new Error('仍有待处理声音，请确认后再导出')
    }
    const bindings = [...version.clips.flatMap((clip) => clip.assetId ? [{ id: clip.assetId, kind: 'video' }] : []),
      ...version.sounds.flatMap((sound) => sound.state === 'bound' && sound.assetId ? [{ id: sound.assetId, kind: sound.sourceKind ?? 'audio' }] : [])]
    const files = new Map<string, string>()
    for (const binding of bindings) {
      const asset = this.media.get(binding.id)
      if (asset.kind !== binding.kind || asset.projectId !== null && asset.projectId !== parsed.projectId) {
        throw new Error('导出素材类型或项目归属不正确')
      }
      files.set(binding.id, this.media.path(binding.id))
    }
    return { version: structuredClone(version), files, ...(parsed.options ? { options: parsed.options } : {}) }
  }

  async export(input: ExportAssembly, target: string, renderer: AssemblyRenderer, signal: AbortSignal,
    onProgress?: (progress: AssemblyRenderProgress) => void): Promise<void> {
    signal.throwIfAborted()
    if (this.active) throw new Error('已有成片正在导出')
    const plan = this.prepare(input)
    this.active = true
    try { await renderer.render(plan, target, signal, onProgress) }
    finally { this.active = false }
  }
}
