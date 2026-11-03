import type { ReferenceKind, DraftReference } from '../../../../shared/contracts/references'

export interface ReferenceRecord extends DraftReference { ordinal: number }
export interface ReferenceRepository {
  list(draftId: string): ReferenceRecord[]
  get(id: string): ReferenceRecord
  nextOrdinal(draftId: string, kind: ReferenceKind): number
  save(records: ReferenceRecord[]): void
  detach(id: string): void
  replace(id: string, expectedAssetId: string, assetId: string): void
}
export interface ReferenceFiles {
  import(id: string, path: string, kind: ReferenceKind): Promise<{ storedName: string; name: string; size: number }>
  discard(storedName: string): Promise<void>
  reveal(storedName: string): void
}
