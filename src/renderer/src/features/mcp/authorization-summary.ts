import type { AssetMcpPreferences } from '@contracts/mcp'

export function mcpAuthorizationSummary(preferences: AssetMcpPreferences, projectName: string, minutes: number): string {
  const scope = preferences.allProjects ? '全部项目（含后续新增项目）及公共素材' : `项目「${projectName}」及公共素材读取`
  const permissions = [
    `授权范围：${scope}`,
    `素材与视频草稿：${preferences.writeEnabled ? '项目范围内读写、引用绑定与分类管理；从授权目录导入文件' : '只读查询'}`,
    `公共音色：${preferences.publicVoicesEnabled ? '独立授权所有公共参考音色只读查询，不包含生成或管理' : '未授权'}`,
    `剧本库：${preferences.scriptLibraryEnabled ? preferences.writeEnabled ? '授权范围内读取、创建和修改' : '授权范围内只读' : '未授权'}`,
    `排片剪辑库：${preferences.assemblyEnabled ? preferences.writeEnabled ? '授权范围内读取、创建、修改工程、版本、片段与声音绑定' : '授权范围内只读' : '未授权'}`,
    `素材生成：${preferences.imageGenerationEnabled ? preferences.writeEnabled ? '查询、脱敏 DNS 诊断与创建待提交节点；可从已有服务结果恢复图片下载归档，不发起生图或上传' : '只读画布、任务、结果及脱敏 DNS 诊断；不下载或生成' : '未授权'}`,
    `生图提交：${preferences.imageSubmissionEnabled && preferences.imageGenerationEnabled && preferences.writeEnabled ? '允许自动排队执行；参考图片将发送至自动选中的启用账号服务，可能消耗其额度。不设金额或提交次数额度，不逐次弹窗；受理不明不会换账号重提' : '未授权'}`,
    `有效期：${minutes === -1 ? '不限时，关闭连接或退出应用后失效' : `${minutes} 分钟`}`,
    ...(preferences.writeEnabled ? [`导入目录：${preferences.importDirectory || '开启前另行选择；取消则不开启'}`] : []),
    `不包含删除、恢复、更改工程或剧本归属、账号配置、${preferences.imageSubmissionEnabled && preferences.imageGenerationEnabled && preferences.writeEnabled ? '视频付费生成' : '付费生成'}、混音或成片导出。`,
    '确认开启本次 MCP 授权？'
  ]
  return permissions.join('\n\n')
}
