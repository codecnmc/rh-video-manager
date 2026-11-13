import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { canUseMediaFullscreen } from './fullscreen-permission'
import { showLocalDialog } from './local-dialog'

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

  const rendererDocumentUrl = rendererUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!contents.isDestroyed() && BrowserWindow.fromWebContents(contents) !== null && canUseMediaFullscreen({
      permission, requestingUrl: details.requestingUrl, topLevelUrl: contents.getURL(), rendererDocumentUrl, isMainFrame: details.isMainFrame
    }))
  })
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!contents || contents.isDestroyed() || !BrowserWindow.fromWebContents(contents)) return false
    return canUseMediaFullscreen({ permission, requestingUrl: details.requestingUrl ?? (details.isMainFrame ? contents.getURL() : ''),
      topLevelUrl: contents.getURL(), rendererDocumentUrl, isMainFrame: details.isMainFrame })
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 教程只开放这两个固定 HTTPS 地址，仍禁止创建应用内窗口或任意外链。
    if (['https://www.runninghub.cn/vip-rights/2', 'https://www.runninghub.cn/workspace'].includes(url)) {
      void shell.openExternal(url).catch(() => {
        if (!window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: '无法打开浏览器，请复制教程中的地址手动访问。' })
      })
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (options?.assembly) window.on('page-title-updated', (event) => event.preventDefault())
  let discardConfirmed = false
  let discardPending = false
  window.webContents.on('will-prevent-unload', (event) => {
    if (discardConfirmed) { discardConfirmed = false; event.preventDefault(); return }
    if (discardPending) return
    // 本轮仍阻止关闭，异步确认后再发起一次关闭；只有新一轮才放行 beforeunload。
    discardPending = true
    void showLocalDialog({ parent: window, title: '修改尚未保存', message: '当前内容尚未保存。放弃修改后将关闭此窗口，未保存的内容无法恢复。',
      cancelLabel: '返回编辑', confirmLabel: '放弃修改并关闭' }).then((confirmed) => {
      if (confirmed && !window.isDestroyed()) { discardConfirmed = true; window.close() }
    }).finally(() => { discardPending = false })
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
