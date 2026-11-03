import type { BrowserWindow } from 'electron'

export type DesktopHandle = <T>(channel: string, action: (input: unknown, window: BrowserWindow) => Promise<T>) => void
