import { useEffect, useState } from 'react'
import type { PreviewSnapshot } from '@contracts/preview'
import { taskTiming } from '../task-timing'

export function TaskTiming({ task }: { task: PreviewSnapshot }) {
  const [now, setNow] = useState(Date.now)
  const { terminal, paused, ticking, seconds, label, source } = taskTiming(task, now)
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking, task.id])
  return <span className="task-timing muted" title={source === 'platform' ? '平台结果接口返回的有效任务消耗时长' : source === 'total' ? '从本地提交至观测到终态的总时间，包含排队和轮询延迟，不是平台纯执行耗时' : task.manualCancellationConfirmedAt ? '截至人工确认的本地观测时间，不是平台最终执行耗时' : paused ? '取消请求已被平台接受，本地计时暂停；仍在核对远端终态，此数值不是最终执行耗时' : '从本机首次观测到运行开始计时，不含排队；离线期间不能确定平台实际起止时间'}>{seconds === null ? paused ? '计时已暂停，等待核对取消结果' : terminal ? '执行耗时未记录' : task.remoteStatus === 'queued' ? '等待执行' : '等待执行计时'
    : `${label} ${seconds > 0 && seconds < 1 ? '不足1秒' : `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`}${paused ? '（计时已暂停）' : ''}`}</span>
}
