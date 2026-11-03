import { confirmAction } from '@/components/ui/confirmation'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { videoDraftSchema, type VideoDraft } from '@contracts/video'
import { h3PromptSchema } from '@contracts/h3'
import { continuousShotInputSchema } from '@contracts/continuity'
import type { PreviewSnapshot } from '@contracts/preview'
import type { ScheduleGeneration } from '@contracts/generation'

export function useGeneration(projectId: string, draftId: string, onNotice: (message: string) => void, onSubmitted: (taskId: string) => void) {
  const client = useQueryClient()
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const request = useRef<{ id: string; replacement?: ScheduleGeneration['replacement'] } | null>(null)

  async function submit(draft: VideoDraft, save: (draft: VideoDraft) => Promise<void>) {
    if (submitting.current) return
    const structure = h3PromptSchema.safeParse(draft.prompt)
    if (!structure.success) { onNotice(structure.error.issues[0]?.message ?? '全能参考结构不完整'); return }
    submitting.current = true
    setPending(true)
    try {
      const references = unwrap(await desktop().listReferences(draftId))
      const continuity = continuousShotInputSchema.safeParse({ ...draft, references })
      if (!continuity.success) throw new Error(continuity.error.issues[0]?.message ?? '连续镜头引用不完整')
      const missing = [...draft.prompt.matchAll(/<(Picture|Video|Audio) [1-9]\d*>/g)]
        .find((match) => !references.some((reference) => reference.label === match[0]))
      if (missing) throw new Error(`未绑定素材：${missing[0]}`)
      const tasks = unwrap(await desktop().listPreviews())
      const unfinished = tasks.filter((task) => task.projectId === projectId && task.draftId === draftId &&
        !['success', 'failed', 'cancelled'].includes(task.remoteStatus) && !task.localReservationReleasedAt && task.id !== request.current?.id)
      if (unfinished.some((task) => !task.taskId)) throw new Error('该草稿仍有准备中或提交受理不明的任务，需先核对原任务，不能重复付费提交')
      const replacementNotice = unfinished.length
        ? `该草稿有 ${unfinished.length} 笔旧任务尚未确认结束，是否仍要重新生成？\n${unfinished.map((task) => `远端任务 ${task.taskId}：${task.cancelState === 'requested' ? '已请求取消，终态待核对' : '未确认结束'}`).join('\n')}\n本次会创建新任务并切换当前预览，保留旧任务和采样，不会再次取消旧任务或把它标记为已取消。若旧任务仍在运行，可能重复计费；不保证退款。\n\n`
        : ''
      const confirmed = await confirmAction(`${replacementNotice}自动选择有可用并发的启用账号及其默认工作流提交生成？\n${draft.duration} 秒 · ${draft.aspectRatio} · ${draft.resolution} · ${draft.instance === 'default' ? 'Lite' : draft.instance === 'plus' ? 'Plus' : 'Ultra'}\n参考素材将上传到 RunningHub，运行会消耗所调度账号的额度，具体费用以平台结算为准。受理不明不会换账号重提；取消不保证退款。`)
      if (!confirmed) return
      await save(draft)
      const workspace = unwrap(await desktop().loadWorkspace())
      const saved = workspace.projects.find((project) => project.id === projectId)?.videoDrafts.find((item) => item.id === draftId)
      if (!saved || JSON.stringify(videoDraftSchema.parse(saved)) !== JSON.stringify(videoDraftSchema.parse(draft))) throw new Error('草稿在确认后发生变化，请重新保存并确认')
      // 传输失败时沿用同一标识；不把一次未知受理变成新的付费请求。
      // 尚未落库的请求可更新本次明确确认的旧任务集合，但传输重试仍沿用原标识。
      if (!request.current || !tasks.some((task) => task.id === request.current?.id)) request.current = { id: request.current?.id ?? crypto.randomUUID(),
        ...(unfinished.length ? { replacement: { taskIds: unfinished.map((task) => task.id), confirmed: true } } : {}) }
      const task = unwrap(await desktop().scheduleGeneration({ requestId: request.current.id, projectId, draftId,
        expectedRevision: workspace.revision, confirmed: true, replacement: request.current.replacement }))
      client.setQueryData<PreviewSnapshot[]>(['previews'], (previous = []) => [task, ...previous.filter((item) => item.id !== task.id)])
      onSubmitted(task.id)
      if (task.taskId || task.remoteStatus === 'failed') request.current = null
      onNotice(task.notice || task.stage)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '提交结果未确认，请查看任务队列，不要重复生成')
    } finally {
      submitting.current = false
      setPending(false)
      void client.invalidateQueries({ queryKey: ['previews'] })
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['account-pool-sync'] }, { cancelRefetch: false })
    }
  }

  return { pending, submit }
}
