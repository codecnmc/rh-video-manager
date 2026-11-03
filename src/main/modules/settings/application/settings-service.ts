import { appPreferencesSchema, settingsDirectorySchema, type AppPreferences, type SettingsDirectory } from '../../../../shared/contracts/settings'
import type { PreferencesRepository, SettingsEnvironment } from '../ports/settings'
import { assetMcpPreferencesSchema, type AssetMcpPreferences } from '../../../../shared/contracts/mcp'
import type { MediaStorageService } from './media-storage-service'

export class SettingsService {
  constructor(private readonly repository: PreferencesRepository, private readonly environment: SettingsEnvironment,
    private readonly mediaStorage?: MediaStorageService) {}
  preferences(): AppPreferences {
    const stored = this.repository.read() ?? { editorMode: 'split', editorFontSize: 14, taskNotifications: false }
    // 已撤回的内置工作流模式可能留在旧数据库中，仅读取时移除，不放宽新请求校验。
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored) && 'workflowMode' in stored) {
      const { workflowMode: _legacyMode, ...current } = stored
      return appPreferencesSchema.parse(current)
    }
    return appPreferencesSchema.parse(stored)
  }
  save(input: Partial<AppPreferences>): AppPreferences {
    // 局部偏好在主进程合并，切换布局不能覆盖通知或编辑器配置。
    const preferences = appPreferencesSchema.parse({ ...this.preferences(), ...appPreferencesSchema.partial().parse(input) })
    this.repository.write(preferences)
    return preferences
  }
  async information() { return { ...await this.environment.information(), ...(this.mediaStorage ? { mediaStorage: this.mediaStorage.status() } : {}) } }
  planMediaStorage(parent: string) { return this.storage().plan(parent) }
  cancelMediaStorage() { return this.storage().cancel() }
  assertCanRestartForStorage(): void { this.storage().assertCanRestart() }
  private storage(): MediaStorageService {
    if (!this.mediaStorage) throw new Error('素材存储设置尚未配置')
    return this.mediaStorage
  }
  mcpPreferences(): AssetMcpPreferences {
    return assetMcpPreferencesSchema.parse(this.repository.readMcp() ?? { projectId: null, allProjects: false,
      writeEnabled: false, minutes: 60, importDirectory: '', scriptLibraryEnabled: false, assemblyEnabled: false, imageGenerationEnabled: false })
  }
  saveMcpPreferences(input: AssetMcpPreferences): AssetMcpPreferences {
    const preferences = assetMcpPreferencesSchema.parse(input)
    this.repository.writeMcp(preferences)
    return preferences
  }
  openDirectory(directory: SettingsDirectory) { return this.environment.openDirectory(settingsDirectorySchema.parse(directory)) }
}
