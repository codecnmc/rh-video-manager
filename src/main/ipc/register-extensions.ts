import { dialog } from 'electron'
import {
  extensionActionSchema, extensionCommandSchema, extensionEnabledSchema, extensionVoicesRequestSchema,
  saveExtensionSecretSchema, saveExtensionSettingsSchema, extensionContextCommandSchema, extensionPageRequestSchema
} from '../../shared/contracts/extensions'
import type { ExtensionService, ExtensionPageService } from '../modules/extensions'
import type { DesktopHandle } from './handle'
import type { WorkspaceService } from '../application/workspace-service'

const permissionNames = {
  'network.local': '连接本机模型服务', 'network.cloud': '连接云端服务',
  'models.local': '使用本地模型文件', 'audio.reference': '处理音色参考录音', 'assets.selection': '接收用户选定的素材文字快照'
}

export function registerExtensions(handle: DesktopHandle, extensions: ExtensionService, workspace: WorkspaceService, pages?: ExtensionPageService): void {
  if (pages) handle('extensions:page', async (input, window) => {
    const parsed = extensionPageRequestSchema.parse(input)
    const prepared = await pages.prepare(parsed)
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '运行插件页面', message: `运行「${prepared.page.title}」？`,
      detail: `插件：${parsed.id}\n将发送当前输入文字及 ${prepared.context.assets.length} 个所选素材的名称、提示词、标签和备注。\n插件可能联网、访问本机文件或产生费用；工作台不会自动重试或代为提交 RunningHub 视频任务。`,
      buttons: ['取消', '运行'], defaultId: 0, cancelId: 0, noLink: true })
    if (answer.response !== 1) return null
    // 原生确认期间项目、素材或插件可能变更，调用前重新校验。
    return pages.run(parsed, prepared.context)
  })
  handle('extensions:list', async () => extensions.list())
  handle('extensions:install', async (_input, window) => {
    const selection = await dialog.showOpenDialog(window, { title: '选择包含 extension.json 的插件包目录', properties: ['openDirectory'] })
    const directory = selection.filePaths[0]
    if (selection.canceled || !directory) return extensions.list()
    return extensions.install(directory, async (manifest) => {
      const answer = await dialog.showMessageBox(window, {
        type: 'warning', title: '信任并安装插件', message: `安装「${manifest.displayName}」${manifest.version}？`,
        detail: `发布者：${manifest.publisher}（未经签名验证）\n声明用途：${manifest.permissions.map((item) => permissionNames[item]).join('、') || '无'}\n\n这是具有当前用户级文件和网络权限的代码插件。声明用途不是系统沙箱，插件可以运行任意代码；只安装你信任的来源。\n\n安装后默认停用，不执行安装脚本、不下载模型、不自动调用生成。`,
        buttons: ['取消', '信任并安装'], defaultId: 0, cancelId: 0, noLink: true
      })
      return answer.response === 1
    })
  })
  handle('extensions:enabled', async (input) => {
    const { id, enabled } = extensionEnabledSchema.parse(input)
    return extensions.setEnabled(id, enabled)
  })
  handle('extensions:remove', async (input, window) => {
    const { id } = extensionActionSchema.parse(input)
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '卸载插件', message: `卸载 ${id}？`,
      detail: '停止插件宿主并移除安装登记与加密密钥。插件包存档、已生成素材和历史记录保留；外部模型服务和进行中的远端操作不会自动取消。',
      buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0, noLink: true })
    return answer.response === 1 ? extensions.remove(id) : extensions.list()
  })
  handle('extensions:settings', async (input) => extensions.saveSettings(saveExtensionSettingsSchema.parse(input)))
  handle('extensions:secret', async (input) => extensions.saveSecret(saveExtensionSecretSchema.parse(input)))
  handle('extensions:command', async (input, window) => {
    const { id, command } = extensionCommandSchema.parse(input)
    const installed = extensions.list().find((item) => item.id === id)
    const contribution = installed?.manifest.contributes.commands.find((item) => item.id === command)
    if (!contribution) throw new Error('插件命令不存在')
    if (contribution.contexts?.length) throw new Error('请从对应的剧本或草稿文档调用此工具')
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '运行插件命令', message: `运行「${contribution.title}」？`,
      detail: `插件：${id}\n命令会激活插件并执行其代码，可能访问本机文件、联网或产生服务费用，具体行为由插件决定。宿主不自动重试。`,
      buttons: ['取消', '运行'], defaultId: 0, cancelId: 0, noLink: true })
    if (answer.response !== 1) return false
    await extensions.runCommand(id, command)
    return true
  })
  handle('extensions:voices', async (input) => {
    const { id, providerId } = extensionVoicesRequestSchema.parse(input)
    return extensions.listVoices(id, providerId)
  })
  handle('extensions:context-command', async (input, window) => {
    const parsed = extensionContextCommandSchema.parse(input)
    const current = await workspace.load()
    const project = current.projects.find((item) => item.id === parsed.context.projectId)
    if (!project || !(parsed.context.kind === 'script' ? project.episodes : project.videoDrafts).some((item) => item.id === parsed.context.entityId)) throw new Error('当前文档不存在，请先保存')
    const extension = extensions.list().find((item) => item.id === parsed.id)
    const command = extension?.manifest.contributes.commands.find((item) => item.id === parsed.command)
    if (!command?.contexts?.includes(parsed.context.kind)) throw new Error('插件命令不适用于当前文档')
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '调用文档插件', message: `运行「${command.title}」？`,
      detail: '将把当前编辑器文字传给此插件。插件可能联网或产生服务费用；返回内容仅作为修改建议，不会直接保存或提交生成。',
      buttons: ['取消', '运行'], defaultId: 0, cancelId: 0 })
    if (answer.response !== 1) return null
    return extensions.runContextCommand(parsed)
  })
}
