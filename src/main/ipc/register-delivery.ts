import { app, dialog } from 'electron'
import type { DesktopHandle } from './handle'
import type { MigrationService } from '../modules/migration'
import type { BuiltinSkillService } from '../modules/skills'
import { migrationPasswordSchema } from '../../shared/contracts/migration'
import { builtinSkillIdSchema } from '../../shared/contracts/skills'

export function registerDelivery(handle: DesktopHandle, migration: MigrationService, skills: BuiltinSkillService): void {
  handle('skills:install', async (input, window) => {
    const id = builtinSkillIdSchema.parse(input === undefined ? 'workbench-storyboard' : input)
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '导入 Codex 技能',
      message: `安装内置技能 ${id}？`, detail: `安装到 ${skills.installDirectory()}\n不包含 Key、Python 环境或项目素材，不覆盖已有同名技能。`,
      buttons: ['取消', '安装'], defaultId: 0, cancelId: 0 })
    return answer.response === 1 ? skills.install(id) : null
  })
  handle('skills:export', async (input, window) => {
    const id = builtinSkillIdSchema.parse(input === undefined ? 'workbench-storyboard' : input)
    const selected = await dialog.showOpenDialog(window, { title: `导出技能 ${id}`, properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return false
    await skills.exportTo(selected.filePaths[0], id); return true
  })
  handle('migration:export', async (input, window) => {
    const { password } = migrationPasswordSchema.parse(input)
    const selected = await dialog.showSaveDialog(window, { title: '导出加密迁移包', defaultPath: `羊驼AI影视-数据迁移-${new Date().toISOString().slice(0, 10)}.avwm`,
      filters: [{ name: '加密工作台迁移包', extensions: ['avwm'] }] })
    if (selected.canceled || !selected.filePath) return false
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '导出含账号凭据的数据',
      message: '导出账号 Key、工作流、项目、剧本、草稿、任务和受管素材？',
      detail: '整个迁移包以本次密码加密，包含视频与生图账号 Key、插件密钥、历史任务和受管素材，不要求历史任务全部结束。请妥善保管密码，遗失无法恢复。导出期间会关闭 MCP；不包含外部引用文件、日志、本机 MCP 授权和媒体引擎路径。',
      buttons: ['取消', '加密导出'], defaultId: 0, cancelId: 0 })
    if (answer.response !== 1) return false
    await migration.exportTo(selected.filePath, password); return true
  })
  handle('migration:import', async (input, window) => {
    const { password } = migrationPasswordSchema.parse(input)
    const selected = await dialog.showOpenDialog(window, { title: '导入加密迁移包', properties: ['openFile'], filters: [{ name: '加密工作台迁移包', extensions: ['avwm'] }] })
    if (selected.canceled || !selected.filePaths[0]) return false
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '迁移到当前电脑', message: '导入到当前空工作台并重启？',
      detail: '仅允许空工作台、相同数据库版本。校验后恢复项目和素材，Key 使用本机系统加密重新保存；MCP 令牌、目录授权和旧电脑媒体引擎路径不恢复，插件默认停用。请先保存未保存的编辑。',
      buttons: ['取消', '导入并重启'], defaultId: 0, cancelId: 0 })
    if (answer.response !== 1) return false
    await migration.importFrom(selected.filePaths[0], password)
    app.relaunch(); app.quit()
    return true
  })
}
