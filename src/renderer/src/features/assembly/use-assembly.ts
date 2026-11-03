import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SaveAssembly } from '@contracts/assembly'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useAssembly(projectId: string | null) {
  const client = useQueryClient()
  const documents = useQuery({ queryKey: ['assemblies', projectId], queryFn: async () => unwrap(await desktop().listAssemblies(projectId)), retry: false, refetchInterval: 3000 })
  const mcp = useQuery({ queryKey: ['asset-mcp'], queryFn: async () => unwrap(await desktop().assetMcpStatus()), retry: false, refetchInterval: 3000 })
  const assets = useQuery({ queryKey: ['assembly-assets', projectId], queryFn: async () => {
    const groups = await Promise.all([desktop().listAssets({ projectId }), ...(projectId ? [desktop().listAssets({ projectId: null })] : [])])
    return groups.flatMap((result) => unwrap(result)).filter((asset) => asset.kind === 'video' || asset.kind === 'audio')
  }, retry: false, refetchInterval: 5000 })
  const save = useMutation({ mutationFn: async (input: SaveAssembly) => unwrap(await desktop().saveAssembly(input)), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['assemblies', projectId] })
  } })
  const importMedia = useMutation({ mutationFn: async (kind: 'video' | 'audio') => unwrap(await desktop().importAssets({
    projectId, categoryId: null, kind, tags: [], prompt: '', notes: ''
  })), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['assembly-assets', projectId] })
    await client.invalidateQueries({ queryKey: ['assets'] })
  } })
  return { documents, assets, save, importMedia, mcp }
}

export function mediaSource(id: string): string { return `workbench-asset://library/${id}` }

export function probeVideo(id: string, kind: 'video' | 'audio' = 'video'): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement(kind)
    const cleanup = () => {
      clearTimeout(timeout); video.onloadedmetadata = null; video.onerror = null
      video.removeAttribute('src'); video.load()
    }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('读取视频时长超时')) }, 15000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration
      cleanup()
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) reject(new Error('无法读取有效的视频时长'))
      else resolve(duration)
    }
    video.onerror = () => { cleanup(); reject(new Error('视频无法读取或格式不受支持')) }
    video.src = mediaSource(id)
  })
}
