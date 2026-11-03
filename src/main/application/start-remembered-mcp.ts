import type { AppPreferences } from '../../shared/contracts/settings'
import { startAssetMcpSchema, type AssetMcpPreferences, type StartAssetMcp } from '../../shared/contracts/mcp'

export async function startRememberedMcp(preferences: AppPreferences, remembered: AssetMcpPreferences,
  projectExists: (id: string) => Promise<boolean>, start: (input: StartAssetMcp, directory: string) => Promise<unknown>): Promise<boolean> {
  // 只恢复已配置目录及有效授权范围；首次空配置不自动猜测项目或扩大权限。
  if (preferences.mcpAutoStart === false || !remembered.importDirectory) return false
  const parsed = startAssetMcpSchema.safeParse(remembered)
  if (!parsed.success) throw new Error('已保存的 MCP 授权范围无效')
  if (parsed.data.projectId && !await projectExists(parsed.data.projectId)) throw new Error('MCP 授权项目已不存在')
  await start(parsed.data, remembered.importDirectory)
  return true
}
