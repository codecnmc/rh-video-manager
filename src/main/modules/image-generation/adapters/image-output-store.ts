import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { ImageOutputDiagnostics } from '../../../../shared/contracts/image-generation'
import type { ImageOutputStore, ImageOutput } from '../ports/image-generation'
import { ImageRequestError } from '../domain/image-errors'
import { allowsImageFakeIp, isImageFakeIp, imageResultTrustOrigin } from './image-network-policy'
import { imageExtension, secureImageRequest, publicImageAddress, maxImageBytes as maxBytes } from './image-http'

export class LocalImageOutputStore implements ImageOutputStore {
  constructor(private readonly directory: string) {}
  async diagnoseOutput(output: ImageOutput, trustedServiceOrigin: string | null): Promise<ImageOutputDiagnostics> {
    if (output.b64_json || !output.url) return { kind: output.b64_json ? 'inline' : 'empty', downloadOrigin: null,
      sameServiceOrigin: false, network: 'not_needed', fakeIpAllowed: false }
    const url = new URL(output.url)
    const trustOrigin = imageResultTrustOrigin(url, trustedServiceOrigin)
    const fakeIpAllowed = allowsImageFakeIp(url, trustOrigin)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const base = { kind: 'url' as const, downloadOrigin: url.origin, sameServiceOrigin: trustedServiceOrigin !== null && url.origin === new URL(trustedServiceOrigin).origin, fakeIpAllowed }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') return { ...base, network: 'blocked' }
    try {
      const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true })
      const blocked = !addresses.length || addresses.some(({ address }) => !publicImageAddress(address) && !(fakeIpAllowed && isImageFakeIp(address)))
      return { ...base, network: blocked ? 'blocked' : addresses.some(({ address }) => isImageFakeIp(address)) ? 'fake_ip' : 'public' }
    } catch { return { ...base, network: 'dns_error' } }
  }
  async saveOutput(nodeId: string, output: ImageOutput, signal: AbortSignal, trustedServiceOrigin: string | null = null) {
    z.string().uuid().parse(nodeId)
    for (const extension of ['png', 'jpg', 'webp'] as const) {
      const storedName = `${nodeId}.${extension}`
      try {
        const bytes = await readFile(join(this.directory, storedName))
        if (!bytes.length || bytes.length > maxBytes || imageExtension(bytes) !== extension) throw new ImageRequestError('已有生成文件损坏，未覆盖')
        return { storedName, size: bytes.length }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    }
    const downloadTrust = output.url ? imageResultTrustOrigin(new URL(output.url), trustedServiceOrigin) : null
    const bytes = output.b64_json ? Buffer.from(output.b64_json, 'base64') : output.url ? await secureImageRequest(output.url, signal, undefined, {}, undefined, downloadTrust) : Buffer.alloc(0)
    if (!bytes.length || bytes.length > maxBytes) throw new ImageRequestError('生成图片为空或超过大小限制')
    const extension = imageExtension(bytes)
    const storedName = `${nodeId}.${extension}`
    await mkdir(this.directory, { recursive: true })
    signal.throwIfAborted()
    const path = join(this.directory, storedName)
    const temporary = join(this.directory, `${nodeId}.${randomUUID()}.part`)
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(bytes)
      await file.sync()
      await file.close()
      signal.throwIfAborted()
      // 与现有成片归档一致：完整文件独占落位，半成品不登记为素材。
      try { await link(temporary, path) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        if (!(await readFile(path)).equals(bytes)) throw new ImageRequestError('已有结果文件不同，未覆盖')
      }
    } finally {
      await file.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
    }
    return { storedName, size: bytes.length }
  }
}
