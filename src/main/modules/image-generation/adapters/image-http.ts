import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ImageHttpError, ImageRequestError } from '../domain/image-errors'
import { allowsImageFakeIp, isImageFakeIp } from './image-network-policy'

export const maxImageBytes = 64 * 1024 * 1024

export function publicImageAddress(address: string): boolean {
  if (isIP(address) === 6) return !/^(::|fc|fd|fe[89ab]|ff)/i.test(address) && !address.includes('.')
  const [a = 0, b = 0] = address.split('.').map(Number)
  return isIP(address) === 4 && a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19))
}

export async function secureImageRequest(raw: string, signal: AbortSignal, body?: Buffer, headers: Record<string, string> = {}, onSending?: () => void, trustedServiceOrigin: string | null = null): Promise<Buffer> {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw new ImageRequestError('仅允许不带凭据的标准 HTTPS 地址')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true }).catch(() => { throw new ImageRequestError('DNS 解析失败') })
  const fakeIpAllowed = allowsImageFakeIp(url, trustedServiceOrigin)
  if (!addresses.length || addresses.some((item) => !publicImageAddress(item.address) && !(fakeIpAllowed && isImageFakeIp(item.address)))) {
    throw new ImageRequestError('服务地址解析到本机、私有网络或受限地址，已阻止发送')
  }
  signal.throwIfAborted()
  const selected = addresses[0]
  if (!selected) throw new ImageRequestError('服务地址无有效 DNS 结果')
  return new Promise((resolve, reject) => {
    // TUN Fake-IP 仍固定 DNS 结果，按原始域名验证 TLS 证书，不允许跳转。
    const req = request(url, { method: body ? 'POST' : 'GET', signal, autoSelectFamily: false, headers: { ...headers, ...(body ? { 'Content-Length': String(body.length) } : {}) },
      lookup: (_name, _options, callback) => callback(null, selected.address, selected.family) }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); reject(new ImageHttpError(response.statusCode ?? 0)); return }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > maxImageBytes) { response.destroy(); reject(new ImageRequestError('图片响应超过大小限制')) }
        else chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('aborted', () => reject(new ImageRequestError('服务响应未完整接收')))
      response.on('error', () => reject(new ImageRequestError('图片响应中断')))
    })
    const timeout = setTimeout(() => req.destroy(new ImageRequestError('图片请求等待超过 10 分钟')), 10 * 60 * 1000)
    req.once('close', () => clearTimeout(timeout))
    req.once('error', (error) => {
      const code = 'code' in error ? String(error.code) : ''
      const safeCode = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ABORT_ERR', 'ERR_INVALID_IP_ADDRESS', 'ERR_INVALID_ARG_TYPE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code) ? `（${code}）` : ''
      reject(error instanceof ImageRequestError ? error : new ImageRequestError(`HTTPS 连接未完成${safeCode}`))
    })
    try { onSending?.() } catch (error) { req.destroy(); reject(error); return }
    if (body) req.write(body)
    req.end()
  })
}

export function imageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' {
  const data = Buffer.from(bytes)
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'webp'
  throw new ImageRequestError('图片格式不支持，仅接受 PNG、JPEG 或 WebP')
}
