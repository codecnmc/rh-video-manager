import { extensionPageRequestSchema, extensionPageAssetSchema, type ExtensionPageRequest, type ExtensionPageContext } from '../../../../shared/contracts/extensions'
import type { ExtensionService } from './extension-service'

export interface ExtensionPageSources {
  projectExists(id: string): Promise<boolean>
  asset(id: string): { id: string; projectId: string | null; name: string; kind: 'image' | 'video' | 'audio' | 'prompt'; prompt: string; notes: string; tags: string[]; archived: boolean }
}

export class ExtensionPageService {
  constructor(private readonly extensions: ExtensionService, private readonly sources: ExtensionPageSources) {}
  async prepare(input: ExtensionPageRequest) {
    const parsed = extensionPageRequestSchema.parse(input)
    const extension = this.extensions.list().find((item) => item.id === parsed.id)
    const page = extension?.manifest.contributes.pages?.find((item) => item.id === parsed.pageId)
    if (!extension?.enabled || !page) throw new Error('插件页面已停用或不存在')
    if (!extension.configured) throw new Error('请先完成插件必填配置')
    if (parsed.projectId && !await this.sources.projectExists(parsed.projectId)) throw new Error('项目已不可用')
    if (parsed.assetIds.length && (!page.acceptsAssets || !extension.manifest.permissions.includes('assets.selection'))) throw new Error('页面未声明素材引用权限')
    const assets = parsed.assetIds.map((id) => {
      const asset = this.sources.asset(id)
      if (asset.archived || asset.projectId !== null && asset.projectId !== parsed.projectId) throw new Error('只能引用当前项目或公共的未归档素材')
      return extensionPageAssetSchema.parse({ id: asset.id, name: asset.name, kind: asset.kind, prompt: asset.prompt, notes: asset.notes, tags: asset.tags })
    })
    return { page, context: { projectId: parsed.projectId, text: parsed.text, assets } }
  }
  async run(input: ExtensionPageRequest, confirmedContext: ExtensionPageContext) {
    const prepared = await this.prepare(input)
    if (JSON.stringify(prepared.context) !== JSON.stringify(confirmedContext)) throw new Error('素材内容已变化，请重新选择并确认')
    return this.extensions.runPage(input.id, input.pageId, prepared.context)
  }
}
