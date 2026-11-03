import type { MediaStorageStatus } from '../../../../shared/contracts/settings'
import type { MediaStorageFiles, MediaStorageRepository } from '../ports/media-storage'

export class MediaStorageService {
  private error = ''
  private planning = false
  constructor(private readonly repository: MediaStorageRepository, private readonly files: MediaStorageFiles,
    private readonly defaultDirectory: string, private readonly assertIdle: () => void) {}

  status(): MediaStorageStatus {
    const state = this.repository.read()
    return { ...state, directory: state.directory ?? this.defaultDirectory, error: this.error }
  }

  async plan(parent: string): Promise<MediaStorageStatus> {
    if (this.planning) throw new Error('正在设置素材位置，请稍候')
    this.assertIdle()
    const state = this.repository.read()
    if (state.pendingDirectory) throw new Error('已有待迁移目录，请先重启或取消更改')
    if (state.cleanupDirectory) throw new Error('旧副本尚未清理，请关闭占用文件的程序后重启重试')
    this.planning = true
    try {
      const directory = await this.files.allocate(parent, state.directory ?? this.defaultDirectory)
      this.assertIdle()
      this.repository.write({ ...state, pendingDirectory: directory })
      this.error = ''
      return this.status()
    } finally { this.planning = false }
  }

  cancel(): MediaStorageStatus {
    if (this.planning) throw new Error('正在设置素材位置，请稍候')
    const state = this.repository.read()
    // 取消计划不删除目标目录，保留可能已复制的文件供用户核对。
    this.repository.write({ ...state, pendingDirectory: null })
    this.error = ''
    return this.status()
  }

  assertCanRestart(): void {
    if (this.planning) throw new Error('正在设置素材位置，请稍候')
    if (!this.status().pendingDirectory && !this.status().cleanupDirectory) throw new Error('没有待执行的素材迁移')
    this.assertIdle()
  }

  async initialize(): Promise<void> {
    let state = this.repository.read()
    if (state.pendingDirectory) {
      try {
        const source = state.directory ?? this.defaultDirectory
        await this.files.copy(source, state.pendingDirectory)
        // 切换路径先持久化，再清理旧副本；中途退出后可重试清理，不能丢失唯一副本。
        state = { directory: state.pendingDirectory, pendingDirectory: null, cleanupDirectory: source }
        this.repository.write(state)
      } catch {
        this.error = '素材迁移失败，仍使用原位置。请检查目标磁盘空间、权限和文件占用后重启重试，或取消更改。'
        return
      }
    }
    if (state.cleanupDirectory && state.directory) {
      try {
        await this.files.cleanup(state.cleanupDirectory, state.directory)
        this.repository.write({ ...state, cleanupDirectory: null })
        this.error = ''
      } catch {
        this.error = '已使用新位置，但部分旧副本未能清理。请关闭占用文件的程序后重启重试。'
      }
    }
  }
}
