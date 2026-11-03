import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { imageSizeSchema, type ImageAccount, type ImageNode } from '../../../../shared/contracts/image-generation'
import type { ImageOutput, ImageProtocol, ImageProtocolCapabilities } from '../ports/image-generation'
import { ImageRequestError } from '../domain/image-errors'
import { imageExtension, secureImageRequest, maxImageBytes as maxBytes } from './image-http'

const outputSchema = z.object({ b64_json: z.string().max(maxBytes).optional(), url: z.string().url().max(8000).optional() })

export class OpenAiImageProtocol implements ImageProtocol {
  readonly capabilities: ImageProtocolCapabilities = {
    id: 'openai-images', execution: 'synchronous', sizes: imageSizeSchema.options, maxReferences: 16, progress: 'phase'
  }
  validate(_account: ImageAccount, node: ImageNode): void {
    if (!this.capabilities.sizes.includes(node.size) || node.references.length > this.capabilities.maxReferences) {
      throw new ImageRequestError('生图协议不支持当前尺寸或参考图数量')
    }
  }
  async generate(account: ImageAccount, key: string, node: ImageNode, paths: string[], signal: AbortSignal, onSending: () => void): Promise<ImageOutput> {
    this.validate(account, node)
    const payload = { model: account.model, prompt: node.prompt, size: node.size, quality: 'high', output_format: 'png', moderation: 'low', n: 1 }
    let body: Buffer
    let contentType: string
    if (paths.length) {
      if (typeof FormData === 'undefined' || typeof Response === 'undefined' || typeof Blob === 'undefined') throw new ImageRequestError('当前运行环境缺少参考图表单编码能力，请升级应用运行时')
      const form = new FormData()
      for (const [name, value] of Object.entries(payload)) form.append(name, String(value))
      let total = 0
      for (const [index, path] of paths.entries()) {
        const bytes = await readFile(path).catch(() => { throw new ImageRequestError('参考图片文件读取失败，请检查文件是否存在及读取权限') })
        total += bytes.length
        if (bytes.length > 20 * 1024 * 1024 || total > maxBytes) throw new ImageRequestError('参考图片超过大小限制')
        const extension = imageExtension(bytes)
        form.append('image[]', new Blob([new Uint8Array(bytes)], { type: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` }), `reference-${index}.${extension}`)
      }
      const encoded = new Response(form)
      contentType = encoded.headers.get('content-type')!
      body = Buffer.from(await encoded.arrayBuffer())
    } else { body = Buffer.from(JSON.stringify(payload)); contentType = 'application/json' }
    const response = await secureImageRequest(`${new URL(account.baseUrl).origin}/v1/images/${paths.length ? 'edits' : 'generations'}`, signal, body,
      { Authorization: `Bearer ${key}`, 'Content-Type': contentType }, onSending, new URL(account.baseUrl).origin)
    let raw: unknown
    try { raw = JSON.parse(response.toString('utf8')) } catch { throw new ImageRequestError('服务已返回 HTTP 200，但响应不是有效 JSON') }
    const envelope = z.object({ data: z.array(outputSchema).length(1) }).safeParse(raw)
    const parsed = envelope.success ? { success: true as const, data: envelope.data.data[0]! } : outputSchema.safeParse(raw)
    if (!parsed.success) throw new ImageRequestError('服务已返回 HTTP 200，但图片响应结构不兼容')
    const output = parsed.data
    if (!output.b64_json && !output.url) throw new ImageRequestError('服务已返回 HTTP 200，但未提供图片；可能是不兼容的异步任务响应')
    return output
  }
}
