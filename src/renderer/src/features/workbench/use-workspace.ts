import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { CopyVideoDraft, DeleteWorkspaceEntity, Workspace } from '@contracts/workspace'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useWorkspace(dirty = false) {
  const client = useQueryClient()
  const [snapshot, setSnapshot] = useState<Workspace>()
  const query = useQuery({ queryKey: ['workspace'], queryFn: async () => unwrap(await desktop().loadWorkspace()), retry: false,
    refetchInterval: 2000, refetchIntervalInBackground: true })
  // 编辑期间连同修订号一起冻结，不能拿旧表单搭配新修订号覆盖 MCP 的更新。
  useEffect(() => {
    if (!dirty && query.data) {
      const latest = query.data
      setSnapshot((current) => !current || latest.revision >= current.revision ? latest : current)
    }
  }, [dirty, query.data])
  const accept = (workspace: Workspace) => {
    client.setQueryData(['workspace'], workspace)
    setSnapshot(workspace)
  }
  const save = useMutation({
    mutationFn: async (workspace: Workspace) => {
      const latest = client.getQueryData<Workspace>(['workspace'])
      if (latest && latest.revision > workspace.revision) throw new Error('检测到外部新版本，请先重新载入视频草稿；当前本地修改尚未写入')
      return unwrap(await desktop().saveWorkspace({ expectedRevision: workspace.revision, workspace }))
    },
    onSuccess: accept
  })
  const remove = useMutation({
    mutationFn: async (input: DeleteWorkspaceEntity) => unwrap(await desktop().deleteWorkspaceEntity(input)),
    onSuccess: async (workspace) => {
      accept(workspace)
      await client.invalidateQueries({ queryKey: ['assets'] })
      await client.invalidateQueries({ queryKey: ['previews'] })
      await client.invalidateQueries({ queryKey: ['asset-mcp'] })
    }
  })
  const copy = useMutation({
    mutationFn: async (input: CopyVideoDraft) => unwrap(await desktop().copyVideoDraft(input)),
    onSuccess: (result) => accept(result.workspace)
  })
  return { ...query, data: snapshot ?? query.data, save, remove, copy,
    hasExternalChanges: Boolean(snapshot && query.data && query.data.revision > snapshot.revision),
    reload: async () => {
      const result = await query.refetch({ throwOnError: true })
      if (result.data) accept(result.data)
      await client.invalidateQueries({ queryKey: ['references'] })
    }
  }
}
