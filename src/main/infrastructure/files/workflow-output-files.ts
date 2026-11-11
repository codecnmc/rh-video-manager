import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export class WorkflowOutputFiles {
  constructor(private readonly directory: string, private readonly allowed: (url: string) => boolean) {}
  async download(id: string, index: number, output: { url: string; extension: string }): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(index) || index < 0 || !/^(png|jpg|jpeg|webp|mp3|wav|flac|m4a|ogg)$/.test(output.extension) || !this.allowed(output.url)) throw new Error('产物地址或类型不受支持')
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, `${id}-${index}.${output.extension}`)
    const file = await open(path, 'w')
    let completed = false
    try {
      const response = await fetch(output.url, { redirect: 'error', signal: AbortSignal.timeout(120000) })
      if (!response.ok || !response.body) throw new Error('产物下载失败')
      let size = 0
      for await (const chunk of response.body) { size += chunk.byteLength; if (size > 512 * 1024 * 1024) throw new Error('产物过大'); await file.writeFile(chunk) }
      if (!size) throw new Error('产物为空')
      completed = true
      return path
    } finally { await file.close(); if (!completed) await this.discard(path) }
  }
  async discard(path: string) { await unlink(path).catch(() => undefined) }
}
