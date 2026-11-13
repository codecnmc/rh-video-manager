import { open } from 'node:fs/promises'
import { extname } from 'node:path'

const mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.otf': 'font/otf'
}

// file:// fetch 在自定义协议下不能保证按 Range 返回 206，显式按字节定位才能让 Chromium 正确 seek。
export async function localMediaResponse(path: string, request: Request): Promise<Response> {
  const file = await open(path, 'r')
  let closed = false
  const close = async () => { if (!closed) { closed = true; await file.close() } }
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('媒体不是文件')
    const size = info.size
    const headers = new Headers({
      'Accept-Ranges': 'bytes', 'Content-Type': mediaTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(size)
    })
    let start = 0, end = size - 1
    const range = request.method === 'GET' ? request.headers.get('Range') : null
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1])
          const requestedEnd = match[2] ? Number(match[2]) : size - 1
          end = Number.isSafeInteger(requestedEnd) ? Math.min(requestedEnd, size - 1) : -1
        } else {
          const suffix = Number(match[2])
          start = Number.isSafeInteger(suffix) && suffix > 0 ? Math.max(0, size - suffix) : -1
        }
      } else start = -1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
        headers.set('Content-Range', `bytes */${size}`)
        headers.set('Content-Length', '0')
        await close()
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
      headers.set('Content-Length', String(end - start + 1))
    }
    if (request.method === 'HEAD' || size === 0) {
      await close()
      return new Response(null, { headers })
    }
    let offset = start
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          request.signal.throwIfAborted()
          const buffer = new Uint8Array(Math.min(64 * 1024, end - offset + 1))
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
          if (!bytesRead) { controller.close(); await close(); return }
          offset += bytesRead
          controller.enqueue(buffer.subarray(0, bytesRead))
          if (offset > end) { controller.close(); await close() }
        } catch (error) { controller.error(error); await close() }
      },
      cancel: close
    })
    return new Response(body, { status: range ? 206 : 200, headers })
  } catch (error) { await close(); throw error }
}
