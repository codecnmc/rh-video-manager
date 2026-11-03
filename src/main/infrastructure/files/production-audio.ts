import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProductionAudioFiles } from '../../modules/production'

export class ManagedProductionAudio implements ProductionAudioFiles {
  constructor(private readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('生成文件 ID 不正确')
    return join(this.directory, `${id}.wav`)
  }
  async stage(id: string, audio: Uint8Array): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    const path = this.path(id)
    await writeFile(path, audio, { flag: 'wx' })
    return path
  }
  async discard(id: string): Promise<void> { await unlink(this.path(id)).catch(() => undefined) }
}
