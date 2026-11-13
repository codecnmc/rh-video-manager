import { app, BrowserWindow, Menu, protocol, Tray } from 'electron'
import { showLocalDialog } from './bootstrap/local-dialog'
import { startupFailureDialog } from './bootstrap/startup-failure-dialog'
import { createWindow } from './bootstrap/create-window'
import { initializeWorkbench } from './bootstrap/workbench'
import { join } from 'node:path'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dataProfileDirectory } from './bootstrap/data-profile'

let tray: Tray | undefined
let startupConfigurationError = false
let startupFailed = false
let startupStage = 'configuration'

// 品牌改名不迁移数据，继续使用原目录中的项目、加密账号和偏好。
try {
  const metadata: unknown = app.isPackaged ? JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) : {}
  app.setPath('userData', dataProfileDirectory(app.getPath('appData'), metadata))
} catch {
  startupConfigurationError = true
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
    if (startupConfigurationError) throw new Error('打包数据配置不可读取')
    startupStage = 'workbench'
    await initializeWorkbench()
    startupStage = 'renderer'
    await createWindow()
    startupStage = 'tray'
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
  }).catch(async (error: unknown) => {
    startupFailed = true
    // 加载失败的空白窗口不能继续承载业务操作或遮挡诊断窗口。
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    const directory = join(app.getPath('userData'), 'logs')
    let logged = false
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INITIALIZATION_FAILED'
    try {
      mkdirSync(directory, { recursive: true })
      // 不记录异常正文或堆栈，避免远端响应中的凭据、签名地址进入日志。
      appendFileSync(join(directory, 'startup.log'), `${new Date().toISOString()} ${startupStage} ${code}\n`, 'utf8')
      logged = true
    } catch { /* 日志目录不可写时仍给出可见提示。 */ }
    const explanation = startupConfigurationError ? '无法读取打包数据配置，请重新解压完整的软件压缩包。'
      : startupStage === 'renderer' && code === 'ERR_CONNECTION_REFUSED'
        ? '未能连接本地界面服务。\n\n请重新运行 pnpm dev，再打开工作台。此错误不代表素材目录迁移失败。'
        : startupStage === 'renderer' ? '主界面加载失败，请检查软件文件是否完整。'
          : '工作台初始化未完成，请检查磁盘空间、数据目录权限及软件文件是否完整。'
    await showLocalDialog(startupFailureDialog(explanation, logged))
    app.exit(1)
  })
}

app.on('window-all-closed', () => {
  if (startupFailed) return
  app.quit()
})

app.on('will-quit', () => {
  tray?.destroy()
  tray = undefined
})
