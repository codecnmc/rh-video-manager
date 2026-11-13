import { app, shell } from 'electron'
import { mkdir, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsEnvironment } from '../../modules/settings'
import type { SettingsDirectory } from '../../../shared/contracts/settings'

export class LocalSettingsEnvironment implements SettingsEnvironment {
  constructor(private readonly mediaDirectory: () => string = () => app.getPath('userData')) {}
  private directory(kind: SettingsDirectory): string {
    return kind === 'media' ? this.mediaDirectory() : kind === 'data' ? app.getPath('userData') : join(app.getPath('userData'), 'logs')
  }
  async information() {
    const dataDirectory = this.directory('data')
    const disk = await statfs(this.mediaDirectory()).catch(() => null)
    return { version: app.getVersion(), dataDirectory, logsDirectory: this.directory('logs'), availableBytes: disk ? disk.bavail * disk.bsize : null,
      manualRestartRequired: !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL) }
  }
  async openDirectory(kind: SettingsDirectory): Promise<void> {
    const directory = this.directory(kind)
    await mkdir(directory, { recursive: true })
    if (await shell.openPath(directory)) throw new Error('无法打开目录')
  }
}
