import { createVoiceSchema, renameVoiceSchema, publicVoiceTag as voiceTag, type RenameVoice, type CreateVoice, type PublicVoice } from '../../../../shared/contracts/voices'
import type { Asset, AssetFilter, ImportAssets, UpdateAsset } from '../../../../shared/contracts/assets'

export interface VoiceLibrary {
  list(filter: AssetFilter): Asset[]
  get(id: string): Asset
  media(id: string): { path: string }
  import(input: ImportAssets, paths: string[], authorize?: () => void): Promise<Asset[]>
  update(input: UpdateAsset): Asset
}
const describe = (asset: Asset): PublicVoice => ({ id: asset.id, assetId: asset.id, name: asset.name, size: asset.size, updatedAt: asset.updatedAt, notes: asset.notes })

export class VoiceService {
  constructor(private readonly library: VoiceLibrary) {}
  list(): PublicVoice[] {
    return this.library.list({ projectId: null, kind: 'audio', archived: false }).filter((asset) => asset.tags.includes(voiceTag)).map(describe)
  }
  get(id: string): PublicVoice {
    const voice = this.list().find((item) => item.id === id)
    if (!voice) throw new Error('公共音色不存在或已归档')
    return voice
  }
  async import(paths: string[]): Promise<PublicVoice[]> {
    return (await this.library.import({ projectId: null, categoryId: null, kind: 'audio', tags: [voiceTag], prompt: '', notes: '' }, paths)).map(describe)
  }
  rename(raw: RenameVoice): PublicVoice {
    const input = renameVoiceSchema.parse(raw)
    this.get(input.id)
    const asset = this.library.get(input.id)
    return describe(this.library.update({ ...asset, name: input.name, expectedUpdatedAt: input.expectedUpdatedAt }))
  }
  async fromAsset(raw: CreateVoice): Promise<PublicVoice> {
    const input = createVoiceSchema.parse(raw)
    const source = this.library.get(input.assetId)
    const authorize = () => {
      const current = this.library.get(source.id)
      if (current.archived || current.kind !== 'audio' || current.updatedAt !== input.expectedUpdatedAt) throw new Error('音频素材已变化，请刷新后重新选择')
    }
    authorize()
    // 复制受管文件到公共素材，原项目删除不会使公共音色失效。
    const copied = await this.library.import({ projectId: null, categoryId: null, kind: 'audio', tags: [voiceTag], prompt: '', notes: `音色名称：${input.name}\n来源音频：${source.name}` }, [this.library.media(source.id).path], authorize)
    const asset = copied[0]!
    return describe(this.library.update({ ...asset, name: input.name, expectedUpdatedAt: asset.updatedAt }))
  }
}
