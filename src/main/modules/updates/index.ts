import { z } from 'zod'
import type { ReleaseUpdate } from '../../../shared/contracts/updates'

export const releasesUrl = 'https://github.com/codecnmc/rh-video-manager/releases'
const latestUrl = 'https://api.github.com/repos/codecnmc/rh-video-manager/releases/latest'
const releaseSchema = z.object({ tag_name: z.string().max(100), draft: z.literal(false), prerelease: z.literal(false) })

function versionParts(version: string): bigint[] {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error('版本格式无法比较，请前往发布页面核对版本')
  return match.slice(1, 4).map((part) => BigInt(part))
}

export async function checkReleaseUpdate(currentVersion: string, request: typeof fetch = fetch): Promise<ReleaseUpdate> {
  let response: Response
  try {
    response = await request(latestUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rh-video-manager' },
      redirect: 'error', signal: AbortSignal.timeout(10_000) })
  } catch { throw new Error('无法连接更新服务，请稍后重试或前往发布页面') }
  // 私有仓库和没有正式 Release 都可能返回 404，不能误报为已是最新版。
  if (response.status === 404) throw new Error('暂无可公开访问的正式版本：仓库可能仍为私有，或尚未发布 Release')
  if (response.status === 403 || response.status === 429) throw new Error('更新服务访问受限或请求过于频繁，请稍后重试')
  if (!response.ok) throw new Error('更新服务暂不可用，请稍后重试')
  let release: z.infer<typeof releaseSchema>
  try {
    const length = Number(response.headers.get('content-length'))
    if (length > 1024 * 1024 || !response.body) throw new Error('invalid')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 1024 * 1024) { await reader.cancel(); throw new Error('invalid') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    release = releaseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
  } catch { throw new Error('更新信息读取失败或格式不正确，请前往发布页面核对') }
  const current = versionParts(currentVersion)
  const latest = versionParts(release.tag_name)
  const difference = latest.findIndex((part, index) => part !== current[index])
  return { currentVersion, latestVersion: release.tag_name, available: difference >= 0 && latest[difference] > current[difference] }
}
