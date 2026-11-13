import { protocol } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import type { LibraryService } from '../../modules/assets'
import type { ManagedSamplingFiles } from './sampling-files'
import { titleFonts } from '../../../shared/assembly-visual'
import { localMediaResponse } from './local-media-response'

export function registerAssetProtocol(library: LibraryService, sampling?: ManagedSamplingFiles, fontDirectory?: string): void {
  protocol.handle('workbench-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (sampling && url.hostname === 'sampling' && ['GET', 'HEAD'].includes(request.method)) {
        return await localMediaResponse(sampling.resolve(request.url), request)
      }
      if (!['GET', 'HEAD'].includes(request.method) || url.search || url.hash || url.username || url.password || url.port) return new Response(null, { status: 400 })
      let path: string
      if (url.hostname === 'fonts' && fontDirectory) {
        // 字体只允许固定清单，不接受文件路径，也不进入业务素材库。
        const font = z.enum(['song', 'sans']).parse(url.pathname.slice(1))
        path = join(fontDirectory, titleFonts[font].file)
      } else if (url.hostname === 'library') {
        const id = z.string().uuid().parse(url.pathname.slice(1))
        path = library.media(id).path
      } else return new Response(null, { status: 400 })
      const response = await localMediaResponse(path, request)
      const headers = new Headers(response.headers)
      if (url.hostname === 'fonts') headers.set('Content-Type', 'font/otf')
      // 素材 ID 不变时文件仍可替换，禁止缓存旧图。
      headers.set('Cache-Control', 'no-store')
      const origin = request.headers.get('Origin')
      // Web Audio 对跨源媒体要求 CORS；仅向本地应用来源开放，不放开任意网站。
      const rendererUrl = process.env['ELECTRON_RENDERER_URL']
      const developmentOrigin = rendererUrl ? new URL(rendererUrl).origin : null
      if (origin === 'null' || origin && origin === developmentOrigin && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        headers.set('Access-Control-Allow-Origin', origin)
        headers.set('Vary', 'Origin')
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch { return new Response(null, { status: 404 }) }
  })
}
