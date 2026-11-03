import { app, dialog, shell } from 'electron'
import { open, writeFile } from 'node:fs/promises'
import { saveLibraryDocumentSchema, deleteLibraryDocumentSchema, libraryScopeSchema, assignLibraryDocumentSchema } from '../../shared/contracts/script-library'
import { appPreferencesSchema, settingsDirectorySchema } from '../../shared/contracts/settings'
import type { ScriptLibraryService } from '../modules/scripts'
import type { SettingsService } from '../modules/settings'
import type { DesktopHandle } from './handle'
import { checkReleaseUpdate, releasesUrl } from '../modules/updates'

const backupLimit = 8 * 1024 * 1024

export function registerPersonalLibrary(handle: DesktopHandle, library: ScriptLibraryService, settings: SettingsService): void {
  handle('script-library:list', async (input) => library.list(libraryScopeSchema.parse(input ?? {}).projectId))
  handle('script-library:assign', async (input) => library.assign(assignLibraryDocumentSchema.parse(input)))
  handle('script-library:save', async (input) => library.save(saveLibraryDocumentSchema.parse(input)))
  handle('script-library:delete', async (input) => { library.remove(deleteLibraryDocumentSchema.parse(input)) })
  handle('settings:preferences', async () => settings.preferences())
  handle('settings:save-preferences', async (input) => settings.save(appPreferencesSchema.partial().parse(input)))
  handle('settings:information', async () => settings.information())
  handle('updates:check', async () => checkReleaseUpdate(app.getVersion()))
  handle('updates:open-releases', async () => { await shell.openExternal(releasesUrl) })
  handle('settings:open-directory', async (input) => settings.openDirectory(settingsDirectorySchema.parse(input)))
  handle('settings:choose-media-directory', async (_input, window) => {
    const selected = await dialog.showOpenDialog(window, { title: '选择素材存储位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '更改素材存储位置',
      message: '将素材存储位置更改到所选目录？',
      detail: `目标父目录：${selected.filePaths[0]}\n会新建独立素材目录。重启时复制图片、音频、成片及采样，逐个校验后切换位置，再清理旧副本；失败保留原位置。数据库、账号和日志不移动。`,
      buttons: ['取消', '设置待迁移位置'], defaultId: 0, cancelId: 0 })
    return answer.response === 1 ? settings.planMediaStorage(selected.filePaths[0]) : null
  })
  handle('settings:cancel-media-change', async () => settings.cancelMediaStorage())
  handle('settings:restart-for-media', async (_input, window) => {
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '重启并迁移素材',
      message: '现在重启应用并执行素材迁移或旧副本清理？', detail: '请先保存编辑内容。文件较多时启动可能需要更长时间，请勿强制结束应用。',
      buttons: ['取消', '重启'], defaultId: 0, cancelId: 0 })
    if (answer.response !== 1) return
    settings.assertCanRestartForStorage()
    app.relaunch()
    app.quit()
  })
  handle('script-library:backup', async (_input, window) => {
    const backup = library.backup()
    const content = JSON.stringify(backup, null, 2)
    if (Buffer.byteLength(content, 'utf8') > backupLimit || backup.documents.length > 1000) throw new Error('剧本库备份超过 8 MiB 或 1000 个文档，当前备份未导出')
    const selected = await dialog.showSaveDialog(window, { title: '导出剧本库备份', defaultPath: 'script-library-backup.json', filters: [{ name: '剧本库备份', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePath) return false
    try { await writeFile(selected.filePath, content, 'utf8') }
    catch { throw new Error('备份写入失败，请检查磁盘和目录权限') }
    return true
  })
  handle('script-library:restore', async (_input, window) => {
    const selected = await dialog.showOpenDialog(window, { title: '导入剧本库备份', properties: ['openFile'], filters: [{ name: '剧本库备份', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePaths[0]) return null
    let data: unknown
    try {
      const file = await open(selected.filePaths[0], 'r')
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > backupLimit) throw new Error('invalid')
        const buffer = Buffer.alloc(backupLimit + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > backupLimit) throw new Error('invalid')
        data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown
      } finally { await file.close() }
    } catch { throw new Error('备份不可读取、格式不正确或超过 8 MiB') }
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '导入剧本库备份', message: '将备份中的文档作为新副本加入剧本库？',
      detail: '不覆盖现有文档，不恢复项目、任务、素材或密钥。重复导入会产生额外副本。', buttons: ['取消', '导入'], defaultId: 0, cancelId: 0 })
    return answer.response === 1 ? library.restore(data) : null
  })
}
