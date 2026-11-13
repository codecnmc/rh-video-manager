import { BrowserWindow } from 'electron'
import { icon } from '@fortawesome/fontawesome-svg-core'
import { faCircleExclamation, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

export interface LocalDialogOptions {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  parent?: BrowserWindow
  tone?: 'warning' | 'error'
  details?: { label: string; value: string }[]
  hint?: string
}

const dialogWindows = new WeakSet<BrowserWindow>()
export function isLocalDialog(window: BrowserWindow): boolean { return dialogWindows.has(window) }

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character)
}

// 独立本地文档不依赖 Vite、主界面或 IPC，启动失败和未保存退出时也能显示。
export async function showLocalDialog(options: LocalDialogOptions): Promise<boolean> {
  const parent = options.parent && !options.parent.isDestroyed() ? options.parent : undefined
  const window = new BrowserWindow({ width: 580, height: options.details?.length ? 410 : 300, minWidth: 480, minHeight: 280,
    title: options.title, frame: false, show: false, resizable: true, autoHideMenuBar: true,
    ...(parent ? { parent, modal: true } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  dialogWindows.add(window)
  window.setMenu(null)
  const actionUrl = 'https://workbench-dialog.invalid/'
  let finish: (confirmed: boolean) => void = () => {}
  const result = new Promise<boolean>((resolve) => {
    let settled = false
    finish = (confirmed) => {
      if (settled) return
      settled = true
      resolve(confirmed)
      if (!window.isDestroyed()) window.destroy()
    }
  })
  window.once('closed', () => finish(false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url === `${actionUrl}confirm`) finish(true)
    if (url === `${actionUrl}cancel`) finish(false)
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); finish(false) }
  })
  const symbol = icon(options.tone === 'error' ? faCircleExclamation : faTriangleExclamation).html.join('')
  const paragraphs = options.message.split(/\n\n+/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
  const details = options.details?.length ? `<dl>${options.details.map((detail) => `<div><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd></div>`).join('')}</dl>` : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(options.title)}</title><style>
    *{box-sizing:border-box}body{margin:0;color:#263438;background:#fff;font:14px 'Segoe UI','Microsoft YaHei',sans-serif;height:100vh;display:flex;flex-direction:column;border:1px solid #e6ebed}
    header{display:flex;align-items:center;gap:14px;padding:26px 28px 16px;-webkit-app-region:drag}h1{margin:0;font-size:19px;line-height:1.4;font-weight:650}.brand{margin:0 0 4px;color:#66777d;font-size:12px;letter-spacing:.5px}.status-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;flex-shrink:0;border-radius:12px;background:#f8efe0;color:#976c27}.status-icon.error{color:#b14d4d;background:#fff1ef}.status-icon svg{width:21px;height:21px}
    main{padding:0 28px;overflow:auto;flex:1;line-height:1.7}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#52636a}p+p{margin-top:12px}dl{margin:18px 0 0;padding:14px 16px;background:#f5f7f8;border:1px solid #e6ebed;border-radius:8px}dl>div+div{margin-top:12px}dt{color:#66777d;font-size:12px;margin-bottom:3px}dd{margin:0;font-size:13px;line-height:1.6;overflow-wrap:anywhere;user-select:text}.hint{margin-top:14px;font-size:12px;color:#66777d}
    footer{display:flex;justify-content:flex-end;gap:10px;padding:20px 28px 24px}a{display:inline-flex;align-items:center;justify-content:center;min-height:36px;min-width:88px;padding:7px 16px;border-radius:5px;text-decoration:none;font-weight:550;border:1px solid #dfe6e8;color:#304148;background:white}a:hover{background:#eef3f4}a.primary{background:#098b91;color:white;border-color:#098b91}a.primary:hover{background:#087b80}a:focus-visible{outline:2px solid #a4d4d6;outline-offset:2px}
    </style></head><body><header><div class="status-icon ${options.tone === 'error' ? 'error' : ''}" aria-hidden="true">${symbol}</div><div><p class="brand">羊驼 AI 影视</p><h1>${escapeHtml(options.title)}</h1></div></header><main>${paragraphs}${details}${options.hint ? `<p class="hint">${escapeHtml(options.hint)}</p>` : ''}</main><footer>${options.cancelLabel ? `<a autofocus href="${actionUrl}cancel">${escapeHtml(options.cancelLabel)}</a>` : ''}<a ${options.cancelLabel ? '' : 'autofocus'} class="primary" href="${actionUrl}confirm">${escapeHtml(options.confirmLabel)}</a></footer></body></html>`
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    if (!window.isDestroyed()) { window.show(); window.focus() }
  } catch { finish(false) }
  return result
}
