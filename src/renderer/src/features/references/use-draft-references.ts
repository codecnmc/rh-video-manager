import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pastedImageMaxBytes, pastedImageSchema, pastedImagesSchema, type ReferenceKind, type DraftReference } from '@contracts/references'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useDraftReferences(draftId: string, saved: boolean) {
  const client = useQueryClient()
  const key = ['references', draftId]
  // MCP 与界面共用持久化引用，但不共用 Query 缓存；独立同步附件，不能依赖表单是否保存。
  const query = useQuery({ queryKey: key, queryFn: async () => unwrap(await desktop().listReferences(draftId)), enabled: saved, retry: false, refetchInterval: 2000 })
  const update = (references: DraftReference[]) => client.setQueryData(key, references)
  return { ...query,
    importFiles: async (kind: ReferenceKind) => {
      update(unwrap(await desktop().importReferences(draftId, kind)))
      await client.invalidateQueries({ queryKey: ['assets'] })
    },
    pasteImages: async (files: File[], saveDraft: () => Promise<void>) => {
      if (files.length < 1 || files.length + (query.data?.filter((reference) => reference.kind === 'image').length ?? 0) > 9) {
        throw new Error('参考图片最多添加 9 张')
      }
      for (const file of files) {
        if (!pastedImageSchema.shape.mimeType.safeParse(file.type).success) throw new Error('粘贴图片仅支持 PNG、JPEG 和 WebP 格式')
        if (!file.size || file.size > pastedImageMaxBytes) throw new Error('图片为空或超过 10 MB 上限')
      }
      // 在保存草稿前捕获数据，避免等待期间剪贴板发生变化。
      const images = pastedImagesSchema.parse(await Promise.all(files.map(async (file, index) => ({
        name: (file.name || `粘贴图片-${index + 1}`).slice(0, 150), mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer())
      }))))
      await saveDraft()
      update(unwrap(await desktop().pasteReferenceImages(draftId, images)))
      await client.invalidateQueries({ queryKey: ['assets'] })
    },
    attach: async (assetId: string) => update(unwrap(await desktop().attachReference(draftId, assetId))),
    replace: async (reference: DraftReference, assetId: string, expectedUpdatedAt: string) => update(unwrap(await desktop().replaceDraftReference({
      draftId, id: reference.id, expectedAssetId: reference.assetId, assetId, expectedUpdatedAt
    }))),
    remove: async (id: string) => {
      unwrap(await desktop().removeReference(id))
      client.setQueryData<DraftReference[]>(key, (current) => (current ?? []).filter((reference) => reference.id !== id))
    },
    reveal: async (id: string) => { unwrap(await desktop().revealReference(id)) }
  }
}
