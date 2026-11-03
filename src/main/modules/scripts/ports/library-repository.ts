import type { LibraryDocument, SaveLibraryDocument, DeleteLibraryDocument, AssignLibraryDocument } from '../../../../shared/contracts/script-library'

export interface ScriptLibraryRepository {
  list(projectId?: string | null): LibraryDocument[]
  assign(input: AssignLibraryDocument, updatedAt: string): LibraryDocument
  save(input: SaveLibraryDocument, updatedAt: string): LibraryDocument
  remove(input: DeleteLibraryDocument, deletedAt: string): void
  insertMany(documents: LibraryDocument[]): void
}
