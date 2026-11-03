import { join } from 'node:path'

export function dataProfileDirectory(appData: string, metadata: unknown): string {
  if (typeof metadata !== 'object' || metadata === null || !('workbenchDataProfile' in metadata)) {
    return join(appData, 'AI 视频工作台')
  }
  const profile = metadata.workbenchDataProfile
  if (profile === 'current') return join(appData, 'AI 视频工作台')
  if (typeof profile === 'string' && /^empty-[a-f0-9-]{36}$/.test(profile)) {
    return join(appData, 'AI 视频工作台 profiles', profile)
  }
  throw new Error('Invalid delivery data profile')
}
