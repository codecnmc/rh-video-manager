import type { Asset, AssetCategory, AssetFilter } from '../../../../shared/contracts/assets'
import type { ReferenceFiles } from './references'
import type { PastedImage } from '../../../../shared/contracts/references'

export interface AssetRecord { asset: Asset; storedName: string | null }
export interface DraftAssetFolder { draftId: string; category: AssetCategory }
export interface AssetRepository {
  list(filter: AssetFilter): Asset[]
  names(projectId: string): string[]
  get(id: string): AssetRecord
  save(records: AssetRecord[], folder?: DraftAssetFolder): void
  replaceFile(record: AssetRecord, expectedUpdatedAt: string): void
  remove(id: string): void
  categories(projectId?: string | null): AssetCategory[]
  draftCategory(draftId: string): AssetCategory | undefined
  saveCategory(category: AssetCategory): void
  removeCategory(id: string): void
}
export interface AssetFiles extends ReferenceFiles {
  readImage(storedName: string): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }>
  localPath(storedName: string): Promise<{ path: string; size: number }>
  importImage(id: string, image: PastedImage): ReturnType<ReferenceFiles['import']>
  resolve(storedName: string): string
}
