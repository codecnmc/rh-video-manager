import { randomUUID } from 'node:crypto'
import { open, rename, unlink, copyFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { PreviewMedia } from '../../../shared/contracts/preview'

export async function exportManagedVideo(path: string, name = 'final.mp4'): Promise<boolean> {
  const choice = await dialog.showSaveDialog({ title: '导出本地成片', defaultPath: name, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
  if (choice.canceled || !choice.filePath) return false
  const temporary = `${choice.filePath}.${randomUUID()}.part`
  try { await copyFile(path, temporary); await rename(temporary, choice.filePath); return true }
  catch { await unlink(temporary).catch(() => undefined); throw new Error('本地成片导出失败，请检查目标目录权限和磁盘空间') }
}

export async function downloadPreview(media: PreviewMedia, allowedUrl: (url: string) => boolean, name?: string): Promise<boolean> {
  const extension = media.mime === 'video/mp4' ? 'mp4' : media.mime.split('/')[1] ?? 'jpg'
  const choice = await dialog.showSaveDialog({
    title: '保存预览', defaultPath: name ?? `preview.${extension}`, filters: [{ name: '预览媒体', extensions: [extension] }]
  })
  if (choice.canceled || !choice.filePath) return false
  const temporary = `${choice.filePath}.${randomUUID()}.part`
  const file = await open(temporary, 'wx')
  let total = 0
  try {
    if (media.source.startsWith(`data:${media.mime};base64,`)) {
      const bytes = Buffer.from(media.source.slice(media.source.indexOf(',') + 1), 'base64')
      await file.writeFile(bytes)
    } else {
      if (!allowedUrl(media.source)) throw new Error('媒体地址不在允许范围内')
      const response = await fetch(media.source, { redirect: 'error', signal: AbortSignal.timeout(120000) })
      if (!response.ok || !response.body) throw new Error('媒体暂不可下载，地址可能已过期')
      for await (const chunk of response.body) {
        total += chunk.byteLength
        if (total > 512 * 1024 * 1024) throw new Error('预览媒体超过 512MB 下载上限')
        await file.writeFile(chunk)
      }
    }
    await file.close()
    await rename(temporary, choice.filePath)
    return true
  } catch {
    await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw new Error('预览下载失败，未完成的临时文件已清理，请重新获取媒体后再试')
  }
}
