import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PreviewMedia } from '../../../shared/contracts/preview'

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' } as const

export class ManagedSamplingFiles {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true }) }

  save(id: string, media: PreviewMedia): PreviewMedia {
    z.string().uuid().parse(id)
    const prefix = `data:${media.mime};base64,`
    if (!media.source.startsWith(prefix) || media.source.length > 35 * 1024 * 1024) throw new Error('采样数据格式无效')
    const encoded = media.source.slice(prefix.length)
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('采样数据编码无效')
    const bytes = Buffer.from(encoded, 'base64')
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('采样数据大小无效')
    const version = Date.parse(z.string().datetime().parse(media.receivedAt))
    const filename = `${id}.${extensions[media.mime]}`
    const target = join(this.directory, filename)
    const temporary = join(this.directory, `${id}.${randomUUID()}.part`)
    // 每个任务保留最新采样，先完整写临时文件再替换，不把半个 MP4 暴露给播放器。
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' })
      renameSync(temporary, target)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* 临时文件未创建或已完成替换。 */ }
      throw error
    }
    return { ...media, source: `workbench-asset://sampling/${filename}?v=${version}` }
  }

  resolve(source: string): string {
    const url = new URL(source)
    if (url.protocol !== 'workbench-asset:' || url.hostname !== 'sampling' || url.username || url.password || url.port || url.hash ||
      !/^\?v=\d{1,16}$/.test(url.search)) throw new Error('采样地址无效')
    const match = /^\/([0-9a-f-]{36})\.(jpg|png|webp|mp4)$/.exec(url.pathname)
    if (!match) throw new Error('采样文件标识无效')
    z.string().uuid().parse(match[1])
    return join(this.directory, `${match[1]}.${match[2]}`)
  }

  forDownload(media: PreviewMedia): PreviewMedia {
    if (!media.source.startsWith('workbench-asset://sampling/')) return media
    const bytes = readFileSync(this.resolve(media.source))
    if (bytes.length > 25 * 1024 * 1024) throw new Error('采样文件超过上限')
    return { ...media, source: `data:${media.mime};base64,${bytes.toString('base64')}` }
  }
}
