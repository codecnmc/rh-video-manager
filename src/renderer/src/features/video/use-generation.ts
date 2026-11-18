import { confirmAction, confirmChoice } from '@/components/ui/confirmation'
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
      const route = unwrap(await desktop().resolveGenerationTarget({ resolution: draft.resolution, ...(draft.generationTarget ? { target: draft.generationTarget } : {}) }))
      const local = route.target.kind === 'comfyui'
      const details = `${draft.duration} 秒 · ${draft.aspectRatio} · ${draft.resolution}`
      const rhNotice = '参考素材将上传到 RunningHub，运行会消耗所选账号额度，具体费用以平台结算为准。'
      let target = route.target
      if (route.comfyBusy === true) {
        const choice = await confirmChoice(`${replacementNotice}${route.name} 正在运行任务。\n${details}\n本次可以加入 ComfyUI 队列，也可以提交到 RunningHub。选择 RunningHub 时会自动匹配启用账号及其默认工作流。\n${rhNotice}`, {
          title: '选择本次生成来源', confirmLabel: '提交到 ComfyUI 队列', alternateLabel: '提交到 RunningHub'
        })
        if (choice === 'cancel') return
        if (choice === 'alternate') target = { kind: 'rh' }
      } else {
        const destination = local ? '参考素材将传入此 ComfyUI 实例，任务按实例队列运行。' : rhNotice
        if (!await confirmAction(`${replacementNotice}使用 ${route.name} 提交生成？\n${details}\n${destination}`, undefined, local ? { confirmLabel: '提交到 ComfyUI 队列' } : undefined)) return
      }
      await save(draft)
      const workspace = unwrap(await desktop().loadWorkspace())
      const saved = workspace.projects.find((project) => project.id === projectId)?.videoDrafts.find((item) => item.id === draftId)
      if (!saved || JSON.stringify(videoDraftSchema.parse(saved)) !== JSON.stringify(videoDraftSchema.parse(draft))) throw new Error('草稿在确认后发生变化，请重新保存并确认')
      // 传输失败时沿用同一标识；不把一次未知受理变成新的付费请求。
      // 尚未落库的请求可更新本次明确确认的旧任务集合，但传输重试仍沿用原标识。
      if (!request.current || !tasks.some((task) => task.id === request.current?.id)) request.current = { id: request.current?.id ?? crypto.randomUUID(),
        ...(unfinished.length ? { replacement: { taskIds: unfinished.map((task) => task.id), confirmed: true } } : {}) }
      const task = unwrap(await desktop().scheduleGeneration({ requestId: request.current.id, projectId, draftId,
        expectedRevision: workspace.revision, target, routingRevision: route.revision, confirmed: true, replacement: request.current.replacement }))
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
