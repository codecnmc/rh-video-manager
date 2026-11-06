import { useState } from 'react'
import type { PreviewSnapshot } from '@contracts/preview'

export function TaskDuration({ task }: { task: PreviewSnapshot }) {
  const archive = task.finalArchive
  const assetId = archive?.status === 'ready' && archive.source === task.final?.source ? archive.assetId : undefined
  const [duration, setDuration] = useState<{ assetId: string; seconds: number } | null>(null)
  const seconds = assetId && duration?.assetId === assetId ? duration.seconds : null
  // 列表仅探测已归档的本地成片，避免为每条历史任务请求远端视频。
  return <span className="queue-duration">
    {seconds !== null ? `${Number(seconds.toFixed(1))} 秒` : task.requestedDuration !== undefined ? `目标 ${task.requestedDuration} 秒` : '未记录'}
    {assetId && <video key={assetId} hidden preload="metadata" src={`workbench-asset://library/${assetId}`} onLoadedMetadata={(event) => {
      const value = event.currentTarget.duration
      if (Number.isFinite(value) && value > 0) setDuration({ assetId, seconds: value })
    }} />}
  </span>
}
