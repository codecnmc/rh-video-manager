import { assemblyDocumentSchema, saveAssemblySchema, type SaveAssembly } from '../../../../shared/contracts/assembly'
import type { AssemblyMedia, AssemblyRepository } from '../ports/assembly'
import { assemblyCapabilities } from './assembly-capabilities'
import { editAssemblySchema, type EditAssembly } from '../../../../shared/contracts/assembly-edit'
import { applyAssemblyEdits } from '../../../../shared/assembly-edit'

export class AssemblyService {
  constructor(private readonly repository: AssemblyRepository, private readonly media: AssemblyMedia, private readonly id: () => string) {}
  list(projectId: string | null) { return this.repository.list(projectId) }
  get(id: string, projectId: string | null) {
    const document = this.repository.list(projectId).find((item) => item.id === id)
    if (!document) throw new Error('排片工程不存在')
    return document
  }
  references(assetId: string): boolean { return this.repository.references(assetId) }
  capabilities() { return assemblyCapabilities() }
  edit(input: EditAssembly) {
    const parsed = editAssemblySchema.parse(input)
    const document = this.get(parsed.id, parsed.projectId)
    if (document.revision !== parsed.expectedRevision) throw new Error('排片工程已更新，请重新读取后编辑')
    const version = document.versions.find((item) => item.id === parsed.versionId)
    if (!version) throw new Error('剪辑版本不存在')
    const edited = applyAssemblyEdits(version, parsed.operations, this.id)
    const next = parsed.copyAs ? { ...edited, id: this.id(), name: parsed.copyAs } : edited
    return this.save({ id: document.id, projectId: document.projectId, expectedRevision: document.revision,
      content: { title: document.title, episode: document.episode, activeVersionId: next.id,
        versions: parsed.copyAs ? [...document.versions, next] : document.versions.map((item) => item.id === next.id ? next : item) } })
  }
  save(input: SaveAssembly) {
    const parsed = saveAssemblySchema.parse(input)
    for (const version of parsed.content.versions) {
      const bindings = [...version.clips.flatMap((clip) => clip.assetId ? [{ id: clip.assetId, kind: 'video' }] : []),
        ...version.sounds.flatMap((sound) => sound.assetId ? [{ id: sound.assetId, kind: sound.sourceKind ?? 'audio' }] : [])]
      for (const binding of bindings) {
        const asset = this.media.get(binding.id)
        if (asset.kind !== binding.kind || asset.projectId !== null && asset.projectId !== parsed.projectId) throw new Error('素材类型或项目归属不正确')
      }
    }
    if (!parsed.id && parsed.expectedRevision !== 0) throw new Error('新工程修订号不正确')
    if (parsed.id && parsed.expectedRevision < 1) throw new Error('已有工程必须提供有效修订号')
    const document = assemblyDocumentSchema.parse({ ...parsed.content, id: parsed.id ?? this.id(), projectId: parsed.projectId,
      revision: parsed.expectedRevision + 1, updatedAt: new Date().toISOString() })
    this.repository.save(document, parsed.expectedRevision)
    return document
  }
}
