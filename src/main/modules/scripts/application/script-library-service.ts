import { saveLibraryDocumentSchema, deleteLibraryDocumentSchema, documentBackupSchema, libraryScopeSchema, assignLibraryDocumentSchema,
  type SaveLibraryDocument, type DeleteLibraryDocument, type DocumentBackup, type AssignLibraryDocument } from '../../../../shared/contracts/script-library'
import type { ScriptLibraryRepository } from '../ports/library-repository'

export class ScriptLibraryService {
  constructor(private readonly repository: ScriptLibraryRepository, private readonly id: () => string) {}
  list(projectId: string | null = null) { return this.repository.list(libraryScopeSchema.parse({ projectId }).projectId) }
  get(id: string) {
    const document = this.repository.list().find((item) => item.id === id)
    if (!document) throw new Error('文档不存在或已删除')
    return document
  }
  assign(input: AssignLibraryDocument) { return this.repository.assign(assignLibraryDocumentSchema.parse(input), new Date().toISOString()) }
  save(input: SaveLibraryDocument) { return this.repository.save(saveLibraryDocumentSchema.parse(input), new Date().toISOString()) }
  remove(input: DeleteLibraryDocument) { this.repository.remove(deleteLibraryDocumentSchema.parse(input), new Date().toISOString()) }
  backup(): DocumentBackup {
    return { format: 'video-workbench-script-library', version: 1,
      documents: this.repository.list().map(({ title, markdown }) => ({ title, markdown })) }
  }
  restore(input: unknown): number {
    const backup = documentBackupSchema.parse(input)
    // 恢复只新增副本，不覆盖原文、不复活软删除记录，也不恢复任务或密钥。
    this.repository.insertMany(backup.documents.map((document) => ({ ...document, projectId: null, id: this.id(), revision: 0, updatedAt: new Date().toISOString() })))
    return backup.documents.length
  }
}
