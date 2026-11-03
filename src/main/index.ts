import { app, BrowserWindow, dialog, Menu, protocol, Tray } from 'electron'
import { createWindow } from './bootstrap/create-window'
import { initializeWorkbench } from './bootstrap/workbench'
import { join } from 'node:path'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dataProfileDirectory } from './bootstrap/data-profile'

let tray: Tray | undefined

// 品牌改名不迁移数据，继续使用原目录中的项目、加密账号和偏好。
try {
  const metadata: unknown = app.isPackaged ? JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) : {}
  app.setPath('userData', dataProfileDirectory(app.getPath('appData'), metadata))
} catch {
  dialog.showErrorBox('无法启动羊驼AI影视', '无法读取打包数据配置，请重新解压完整的软件压缩包。未修改现有数据。')
  app.exit(1)
}
app.setName('羊驼AI影视')
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'local.ai-video-workbench' : 'local.ai-video-workbench.dev')
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

// 同一数据目录只允许一个写入进程，尤其不能在迁移素材时启动第二个旧路径写入者。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  app.whenReady().then(async () => {
    await initializeWorkbench()
    await createWindow()
    tray = new Tray(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'alpaca.png'))
    const showWindow = () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    tray.setToolTip('羊驼AI影视')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]))
    tray.on('double-click', showWindow)
  }).catch((error: unknown) => {
    const directory = join(app.getPath('userData'), 'logs')
    let logged = false
    try {
      mkdirSync(directory, { recursive: true })
      // 不记录异常正文或堆栈，避免远端响应中的凭据、签名地址进入日志。
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INITIALIZATION_FAILED'
      appendFileSync(join(directory, 'startup.log'), `${new Date().toISOString()} ${code}\n`, 'utf8')
      logged = true
    } catch { /* 日志目录不可写时仍给出可见提示。 */ }
    dialog.showErrorBox('羊驼AI影视启动失败', `工作台初始化未完成。请检查磁盘空间、数据目录权限及软件文件是否完整。\n数据目录：${app.getPath('userData')}\n${logged ? `诊断记录：${join(directory, 'startup.log')}` : '诊断记录无法写入，请检查目录权限。'}\n请勿删除原数据目录。`)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  tray?.destroy()
  tray = undefined
})
