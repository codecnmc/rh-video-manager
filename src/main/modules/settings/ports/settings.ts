import type { AppPreferences, AppInformation, SettingsDirectory } from '../../../../shared/contracts/settings'
import type { AssetMcpPreferences } from '../../../../shared/contracts/mcp'

export interface PreferencesRepository {
  read(): unknown
  write(preferences: AppPreferences): void
  readMcp(): unknown
  writeMcp(preferences: AssetMcpPreferences): void
}
export interface SettingsEnvironment {
  information(): Promise<AppInformation>
  openDirectory(directory: SettingsDirectory): Promise<void>
}
