import { useState } from 'react'
import type { PreviewSnapshot } from '@contracts/preview'
import { confirmAction } from '@/components/ui/confirmation'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { canResolveTask } from './queue-state'

export function useTaskBatch(onReload: () => void, onNotice: (message: string) => void) {
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  async function run(tasks: PreviewSnapshot[], action: 'cancel' | 'confirm' | 'release') {
    if (busy || !tasks.length) return
    const descriptions = {
      cancel: '向原账号发送取消请求，不代表远端已终止，不保证退款。',
      confirm: '请先在 RunningHub 逐笔核实这些任务均已取消。将记录人工确认并解除本地占位，保留最后远端状态；这不是平台回执，不代表退款。',
      release: '仅解除本地占位，不取消远端任务，不改变远端状态，监听保留。再次生成可能重复计费。'
    }
    if (action !== 'cancel' && tasks.some((task) => !canResolveTask(task))) { onNotice('所选任务包含不能人工处理的状态，请刷新后重选'); return }
    if (!await confirmAction(`对以下 ${tasks.length} 个任务执行操作？\n${tasks.map((task) => task.taskId).join('、')}\n${descriptions[action]}`)) return
    setBusy(true)
    const failed: string[] = []
    try {
      // 逐笔使用原有用例校验，不把批量操作当作绕过任务状态或原账号约束的权限。
      for (const task of tasks) {
        try {
          if (action === 'cancel') unwrap(await desktop().cancelTask(task.id))
          else if (action === 'confirm') unwrap(await desktop().confirmGenerationCancellation(task.id, task.taskId, true))
          else unwrap(await desktop().releaseGenerationReservation(task.id, task.taskId, true))
        } catch { failed.push(task.id) }
      }
      setSelected((current) => current.filter((id) => !tasks.some((task) => task.id === id) || failed.includes(id)))
      onReload()
      onNotice(`已处理 ${tasks.length - failed.length} 项${failed.length ? `，失败 ${failed.length} 项，请刷新核对后重试` : ''}`)
    } finally { setBusy(false) }
  }
  return { busy, selected, setSelected, run }
}
