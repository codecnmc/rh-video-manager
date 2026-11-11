import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { StartWorkflowRun } from '@contracts/workflow-runs'
import type { Workflow } from '@contracts/workflows'
import { confirmAction } from '@/components/ui/confirmation'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useWorkflowRuns(workflowId?: string) {
  const client = useQueryClient()
  const requestId = useRef<string | null>(null)
  const query = useQuery({ queryKey: ['workflow-runs', workflowId], queryFn: async () => unwrap(await desktop().listWorkflowRuns(workflowId)), retry: false, refetchInterval: 3000 })
  const outputIds = (query.data ?? []).flatMap((run) => run.assets.map((asset) => asset.id)).join(',')
  useEffect(() => { if (outputIds) void client.invalidateQueries({ queryKey: ['assets'] }) }, [client, outputIds])
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ['workflow-runs'] }); await client.invalidateQueries({ queryKey: ['assets'] }) }
  return { ...query,
    async start(workflow: Workflow, values: StartWorkflowRun['values'], instance: StartWorkflowRun['instance']) {
      if (!workflow.checkedAt) throw new Error('请先成功检测工作流')
      if (!await confirmAction(`使用工作流「${workflow.name}」及其所属账号运行？\n账号 ID：${workflow.accountId}\n参考文件将上传至 RunningHub，本次会消耗该账号额度，以平台结算为准。产物保存到公共素材库，所有项目可用。受理不明不会自动重试或换账号。`)) return false
      requestId.current ??= crypto.randomUUID()
      const result = unwrap(await desktop().startWorkflowRun({ requestId: requestId.current, workflowId: workflow.id, expectedCheckedAt: workflow.checkedAt, expectedApplicationUpdatedAt: workflow.application?.updatedAt || null, values, instance, confirmed: true }))
      if (result.status !== 'unknown' && result.status !== 'submitting' && result.status !== 'preparing') requestId.current = null
      await invalidate()
      if (result.status === 'failed' || result.status === 'unknown') throw new Error(result.message)
      return true
    },
    chooseMedia: async (workflowId: string, key: string) => unwrap(await desktop().chooseWorkflowMedia(workflowId, key)),
    async chooseVoice(id: string) {
      const asset = unwrap(await desktop().listAssets({ projectId: null, kind: 'audio' })).find((item) => item.id === id && !item.archived)
      if (!asset) throw new Error('参考音色已不可用，请刷新后重选')
      return asset
    },
    async refresh(id: string) { const result = unwrap(await desktop().refreshWorkflowRun(id)); await invalidate(); return result },
    async removeFailed(id: string, expectedUpdatedAt: string) {
      if (!await confirmAction('移除此条失败记录？记录将从历史列表隐藏，已有素材和后台记录保留。')) return
      unwrap(await desktop().removeFailedWorkflowRun(id, expectedUpdatedAt)); await invalidate()
    },
    async reveal(id: string) { unwrap(await desktop().revealAsset(id)) },
    async makeVoice(id: string) {
      const asset = unwrap(await desktop().listAssets({ projectId: null, kind: 'audio' })).find((item) => item.id === id)
      if (!asset) throw new Error('产物已不可用，请刷新')
      unwrap(await desktop().createPublicVoice({ assetId: id, expectedUpdatedAt: asset.updatedAt, name: asset.name }))
      await client.invalidateQueries({ queryKey: ['public-voices'] })
    }
  }
}
