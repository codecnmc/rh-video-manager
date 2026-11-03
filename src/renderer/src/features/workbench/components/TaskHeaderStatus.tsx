import type { PreviewSnapshot } from '@contracts/preview'
import { Progress } from '@/components/ui/progress'
import { TaskTiming } from './TaskTiming'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStop } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/ui/confirmation'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function TaskHeaderStatus({ task, onNotice }: { task: PreviewSnapshot | undefined; onNotice: (message: string) => void }) {
  const [pending, setPending] = useState(false)
  if (!task) return <span className="muted">暂无生成任务</span>
  const active = !task.manualCancellationConfirmedAt && task.remoteStatus !== 'success' && task.remoteStatus !== 'failed' && task.remoteStatus !== 'cancelled' && task.cancelState !== 'requested'
  const progress = task.total > 0 ? Math.max(0, Math.min(100, Math.round(task.step / task.total * 100))) : null
  return <div className="task-header-status" aria-live="polite">
    <span className={`connection-dot ${task.connection === 'connected' ? 'online' : ''}`} />
    <span className="task-header-stage" title={task.stage}>{task.stage}</span>
    <TaskTiming task={task} />
    <span className="muted">{progress === null ? '进度未知' : `当前节点 ${progress}%`}</span>
    {active && <Progress value={progress} aria-label="当前生成节点进度" />}
    {active && task.taskId && <Button variant="ghost" size="icon" title="停止当前生成" aria-label="停止当前生成" disabled={pending || task.cancelState === 'requesting'} onClick={async () => {
      if (!await confirmAction(`向原账户请求取消任务 ${task.taskId}？取消不保证退款，也不会立即确认终止。`)) return
      setPending(true)
      try { unwrap(await desktop().cancelTask(task.id)); onNotice('取消请求已发送，继续核对远端状态') }
      catch (error) { onNotice(error instanceof Error ? error.message : '取消失败') }
      finally { setPending(false) }
    }}><FontAwesomeIcon icon={faStop} /></Button>}
  </div>
}
