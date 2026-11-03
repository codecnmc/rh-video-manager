import type { DesktopApi, Result } from '@contracts/desktop'

declare global { interface Window { workbench?: DesktopApi } }

export function desktop(): DesktopApi {
  if (!window.workbench) throw new Error('请在 Electron 桌面应用中打开工作台')
  return window.workbench
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}
