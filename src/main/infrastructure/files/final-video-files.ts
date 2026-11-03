import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, stat, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const limit = 512 * 1024 * 1024

export function finalVideoAssetId(jobId: string, source: string): string {
  const url = new URL(source)
  // 签名刷新不产生重复素材；不同输出路径仍保留为不同成片。
  const bytes = createHash('sha256').update(`${jobId}\n${url.origin}${url.pathname}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 15) | 80
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class ManagedFinalVideoFiles {
  constructor(private readonly directory: string, private readonly allowedUrl: (source: string) => boolean) {}

  private async size(path: string): Promise<number> {
    const info = await stat(path)
    if (!info.isFile() || info.size < 12 || info.size > limit) throw new Error('成片文件大小无效')
    const file = await open(path, 'r')
    try {
      const header = Buffer.alloc(12)
      const { bytesRead } = await file.read(header, 0, 12, 0)
      if (bytesRead !== 12 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('返回内容不是 MP4 视频')
      return info.size
    } finally { await file.close() }
  }

  async save(jobId: string, source: string, signal: AbortSignal) {
    if (!this.allowedUrl(source)) throw new Error('成片地址不在允许范围内')
    signal.throwIfAborted()
    const id = finalVideoAssetId(jobId, source)
    const storedName = `${id}.mp4`
    await mkdir(this.directory, { recursive: true })
    const target = join(this.directory, storedName)
    try { return { id, storedName, size: await this.size(target) } }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    const temporary = join(this.directory, `${id}.${randomUUID()}.part`)
    const file = await open(temporary, 'wx')
    let total = 0
    try {
      const response = await fetch(source, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]) })
      if (!response.ok || !response.body) throw new Error('成片地址不可下载或已过期')
      const declared = response.headers.get('content-length')
      if (declared && Number(declared) > limit) throw new Error('成片超过下载上限')
      for await (const chunk of response.body) {
        signal.throwIfAborted()
        total += chunk.byteLength
        if (total > limit) throw new Error('成片超过下载上限')
        await file.writeFile(chunk)
      }
      await file.sync()
      await file.close()
      await this.size(temporary)
      signal.throwIfAborted()
      // 完成文件独占落位，重试不覆盖已有成片；半成品永远不登记为素材。
      try { await link(temporary, target) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
      return { id, storedName, size: await this.size(target) }
    } finally {
      await file.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
    }
  }
}
