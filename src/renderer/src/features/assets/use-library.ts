import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssetFilter, ImportAssets, AutoImportAssets, SaveCategory, SavePromptAsset, UpdateAsset, MoveAssets } from '@contracts/assets'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { readPastedImages } from '@/shared/lib/read-pasted-images'

export function useAssetCategories(projectId?: string | null) {
  return useQuery({ queryKey: ['asset-categories', { projectId }], queryFn: async () => unwrap(await desktop().listAssetCategories(projectId)), retry: false, refetchInterval: 5000 })
}

export function useLibrary(filter: AssetFilter = {}) {
  const client = useQueryClient()
  const assets = useQuery({ queryKey: ['assets', filter], queryFn: async () => unwrap(await desktop().listAssets(filter)), retry: false, refetchInterval: 5000 })
  const categories = useAssetCategories(filter.projectId)
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['assets'] })
    await client.invalidateQueries({ queryKey: ['asset-categories'] })
    await client.invalidateQueries({ queryKey: ['references'] })
  }
  return { assets, categories, refresh,
    pasteFiles: async (files: File[], projectId: string | null, categoryId: string | null) => {
      const native = unwrap(await desktop().importAssetFiles({ projectId, categoryId }, files))
      if (native !== null) { await refresh(); return native }
      if (files.some((file) => !file.type.startsWith('image/'))) throw new Error('无法读取本地媒体文件，请通过导入按钮选择文件')
      const images = await readPastedImages(files)
      const imported = unwrap(await desktop().pasteAssets({ projectId, categoryId, images }))
      await refresh()
      return imported
    },
    move: async (input: MoveAssets) => { const moved = unwrap(await desktop().moveAssets(input)); await refresh(); return moved },
    importFiles: async (input: ImportAssets | AutoImportAssets) => { const imported = unwrap(await desktop().importAssets(input)); await refresh(); return imported },
    savePrompt: async (input: SavePromptAsset) => { const asset = unwrap(await desktop().savePromptAsset(input)); await refresh(); return asset },
    update: async (input: UpdateAsset) => { const asset = unwrap(await desktop().updateAsset(input)); await refresh(); return asset },
    archive: async (id: string, archived: boolean) => { unwrap(await desktop().archiveAsset(id, archived)); await refresh() },
    remove: async (id: string) => { unwrap(await desktop().deleteAsset(id)); await refresh() },
    saveCategory: async (input: SaveCategory) => { unwrap(await desktop().saveAssetCategory(input)); await refresh() },
    deleteCategory: async (id: string) => { unwrap(await desktop().deleteAssetCategory(id)); await refresh() },
    moveCategory: async (id: string, parentId: string | null) => { unwrap(await desktop().moveAssetCategory(id, parentId)); await refresh() },
    reveal: async (id: string) => { unwrap(await desktop().revealAsset(id)) },
    copyPrompt: async (id: string) => { unwrap(await desktop().copyAssetPrompt(id)) },
    copyImage: async (id: string) => { unwrap(await desktop().copyAssetImage(id)) },
    copyId: async (id: string) => { unwrap(await desktop().copyAssetId(id)) }
  }
}
