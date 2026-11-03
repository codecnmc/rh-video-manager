import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeImage } from 'electron'

export async function createWindow(options?: { assembly?: true; workbench?: true; onCreated: (window: BrowserWindow) => void }): Promise<BrowserWindow> {
  const rendererUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const developmentUrl = rendererUrl ? new URL(rendererUrl) : undefined
  const iconDirectory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  // 窗口使用显式解码的 PNG；ICO 留给 Windows Shell 的快捷方式与重启属性。
  const windowIcon = nativeImage.createFromPath(join(iconDirectory, 'alpaca.png'))
  if (windowIcon.isEmpty()) throw new Error('应用图标加载失败，请检查 alpaca.png 资源是否完整')

  if (developmentUrl && (
    developmentUrl.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(developmentUrl.hostname)
  )) {
    throw new Error('开发服务器只允许使用本机 HTTP 地址')
  }

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,
    title: options?.assembly ? '羊驼AI影视 · 剪辑' : '羊驼AI影视',
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  options?.onCreated(window)
  window.setMenu(null)
  if (process.platform === 'win32') {
    // Windows Shell 不识别 ASAR 虚拟路径，任务栏重启图标必须是包外实体文件。
    window.setAppDetails({
      appId: app.isPackaged ? 'local.ai-video-workbench' : 'local.ai-video-workbench.dev',
      appIconPath: join(iconDirectory, 'alpaca.ico'),
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: '羊驼AI影视'
    })
  }
  const sendWindowState = () => { if (!window.isDestroyed()) window.webContents.send('window:state', window.isMaximized()) }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)

  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (options?.assembly) window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', title: '修改尚未保存', message: '当前内容尚未保存，是否放弃修改并关闭？',
      buttons: ['返回编辑', '放弃修改'], defaultId: 0, cancelId: 0
    })
    if (choice === 1) event.preventDefault()
  })
  window.once('ready-to-show', () => { if (options?.assembly) window.maximize(); window.show() })

  if (rendererUrl) {
    await window.loadURL(options?.assembly ? `${rendererUrl.split('#')[0]}#assembly` : rendererUrl)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), options?.assembly ? { hash: 'assembly' } : {})
  }

  if (!app.isPackaged && !options) {
    window.webContents.openDevTools({ mode: 'detach' })
  }
  return window
}
