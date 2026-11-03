export interface MigrationArchive {
  exportTo(path: string, password: string): Promise<void>
  importFrom(path: string, password: string): Promise<void>
  assertEmpty(): void
}
