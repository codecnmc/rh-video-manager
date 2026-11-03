import { isIP } from 'node:net'

export function isImageFakeIp(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return isIP(address) === 4 && first === 198 && (second === 18 || second === 19)
}

export function allowsImageFakeIp(url: URL, trustedServiceOrigin: string | null): boolean {
  // 仅信任用户已配置并确认外发的服务源，不把第三方结果 URL 一并加入信任范围。
  const hostname = url.hostname.toLowerCase()
  return trustedServiceOrigin === url.origin && url.protocol === 'https:' && !isIP(hostname) &&
    hostname.includes('.') && !hostname.endsWith('.localhost') && !hostname.endsWith('.local') && !hostname.endsWith('.internal')
}

export function imageResultTrustOrigin(url: URL, serviceOrigin: string | null): string | null {
  // 仅用于服务已返回且由主进程加密保存的图片结果，不接受 MCP/UI 传入任意下载 URL。
  // CDN 与 API 通常不同源；允许其 Fake-IP 映射，但仍须是公网形式域名、有效 TLS，其他私网 IP 继续禁止。
  if (!serviceOrigin) return null
  const service = new URL(serviceOrigin)
  if (!allowsImageFakeIp(service, service.origin) || service.username || service.password) return null
  if (url.username || url.password || url.port && url.port !== '443' || url.hash) return null
  return allowsImageFakeIp(url, url.origin) ? url.origin : null
}
