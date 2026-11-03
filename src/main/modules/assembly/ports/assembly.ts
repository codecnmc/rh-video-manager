import type { Asset } from '../../../../shared/contracts/assets'
import type { AssemblyDocument } from '../../../../shared/contracts/assembly'

export interface AssemblyRepository {
  list(projectId: string | null): AssemblyDocument[]
  save(document: AssemblyDocument, expectedRevision: number): void
  references(assetId: string): boolean
}
export interface AssemblyMedia {
  get(id: string): Asset
}
