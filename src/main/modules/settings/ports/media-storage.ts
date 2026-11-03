export interface MediaStorageState {
  directory: string | null
  pendingDirectory: string | null
  cleanupDirectory: string | null
}
export interface MediaStorageRepository {
  read(): MediaStorageState
  write(state: MediaStorageState): void
}
export interface MediaStorageFiles {
  allocate(parent: string, source: string): Promise<string>
  copy(source: string, target: string): Promise<void>
  cleanup(source: string, target: string): Promise<void>
}
