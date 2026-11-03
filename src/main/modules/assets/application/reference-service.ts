import { pastedImagesSchema, replaceDraftReferenceSchema, type ReplaceDraftReference, type DraftReference, type ReferenceKind, type PastedImage } from '../../../../shared/contracts/references'
import type { ReferenceRepository } from '../ports/references'
import type { LibraryService } from './library-service'

const labels = { image: 'Picture', video: 'Video', audio: 'Audio' } as const
const limits = { image: 9, video: 3, audio: 3 } as const

export class ReferenceService {
  constructor(private readonly repository: ReferenceRepository, private readonly library: LibraryService, private readonly id: () => string) {}
  list(draftId: string): DraftReference[] {
    return this.repository.list(draftId).map(({ ordinal: _ordinal, ...reference }) => reference)
  }
  capacity(draftId: string, kind: ReferenceKind, count: number): void {
    if (this.list(draftId).filter((reference) => reference.kind === kind).length + count > limits[kind]) throw new Error('参考素材数量超过当前表单上限')
  }
  async importImages(draftId: string, projectId: string, draftTitle: string, images: PastedImage[]): Promise<DraftReference[]> {
    const parsed = pastedImagesSchema.parse(images)
    const authorize = () => this.capacity(draftId, 'image', parsed.length)
    authorize()
    // 排队和写文件期间可能新增引用，落库前再次检查整批容量。
    const imported = await this.library.importImages(projectId, draftTitle, parsed, authorize, draftId)
    for (const asset of imported) this.attach(draftId, projectId, asset.id)
    return this.list(draftId)
  }
  attach(draftId: string, projectId: string, assetId: string): DraftReference[] {
    const asset = this.library.get(assetId)
    if (asset.kind === 'prompt') throw new Error('提示词素材应插入编辑器，不作为媒体引用')
    if (asset.archived) throw new Error('请先恢复已归档的素材')
    if (asset.projectId && asset.projectId !== projectId) throw new Error('不能引用其他项目的素材，请使用当前项目或公共素材')
    const current = this.list(draftId)
    if (current.some((reference) => reference.assetId === assetId)) return current
    this.capacity(draftId, asset.kind, 1)
    const ordinal = this.repository.nextOrdinal(draftId, asset.kind)
    this.repository.save([{ id: this.id(), draftId, assetId, kind: asset.kind, name: asset.name, size: asset.size,
      ordinal, label: `<${labels[asset.kind]} ${ordinal}>` }])
    return this.list(draftId)
  }
  get(id: string): DraftReference {
    const { ordinal: _ordinal, ...reference } = this.repository.get(id)
    return reference
  }
  replace(raw: ReplaceDraftReference, projectId: string): DraftReference[] {
    const input = replaceDraftReferenceSchema.parse(raw)
    const current = this.repository.get(input.id)
    if (current.draftId !== input.draftId || current.assetId !== input.expectedAssetId) throw new Error('引用已变化，请重新载入后替换')
    const asset = this.library.get(input.assetId)
    if (asset.archived || asset.kind !== current.kind || asset.updatedAt !== input.expectedUpdatedAt ||
      asset.projectId !== null && asset.projectId !== projectId) throw new Error('请选择当前项目或公共素材中未归档、未变更的同类型素材')
    if (this.list(input.draftId).some((reference) => reference.id !== input.id && reference.assetId === input.assetId)) throw new Error('该素材已被其他引用使用')
    this.repository.replace(input.id, input.expectedAssetId, input.assetId)
    return this.list(input.draftId)
  }
  copy(sourceDraftId: string, targetDraftId: string, projectId: string): void {
    if (sourceDraftId === targetDraftId) throw new Error('不能复制引用到源草稿')
    if (this.repository.list(targetDraftId).length) throw new Error('目标草稿已有引用，不能重复复制')
    const records = this.repository.list(sourceDraftId)
    for (const kind of ['image', 'video', 'audio'] as const) this.capacity(targetDraftId, kind, records.filter((item) => item.kind === kind).length)
    for (const reference of records) {
      const asset = this.library.get(reference.assetId)
      if (asset.archived || asset.projectId && asset.projectId !== projectId) throw new Error('源草稿含不可用或跨项目素材，未复制')
    }
    // 保留编号空洞与标签，提示词及 Tiptap 文档中的 Picture/Video/Audio 引用无需改写。
    this.repository.save(records.map((reference) => ({ ...reference, id: this.id(), draftId: targetDraftId })))
  }
  detach(id: string): void { this.repository.get(id); this.repository.detach(id) }
  reveal(id: string): void { this.library.reveal(this.repository.get(id).assetId) }
}
