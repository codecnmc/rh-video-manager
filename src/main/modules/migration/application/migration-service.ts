import type { MigrationArchive } from '../ports/migration'

export class MigrationService {
  private busy = false
  private imported = false
  constructor(private readonly archive: MigrationArchive,
    private readonly prepare: (mode: 'export' | 'import') => void | (() => void)) {}
  isBusy(): boolean { return this.busy }
  assertAvailable(): void {
    if (this.imported) throw new Error('数据已导入，请重启应用后继续使用')
    if (this.busy) throw new Error('正在迁移数据，请等待完成，不要关闭应用')
  }
  private async run(mode: 'export' | 'import', action: () => Promise<void>): Promise<void> {
    this.assertAvailable()
    this.busy = true
    let resume: void | (() => void) = undefined
    try {
      resume = this.prepare(mode)
      await action()
    } finally {
      try { resume?.() } finally { this.busy = false }
    }
  }
  exportTo(path: string, password: string) { return this.run('export', () => this.archive.exportTo(path, password)) }
  importFrom(path: string, password: string) {
    return this.run('import', async () => {
      this.archive.assertEmpty()
      await this.archive.importFrom(path, password)
      this.imported = true
    })
  }
}
