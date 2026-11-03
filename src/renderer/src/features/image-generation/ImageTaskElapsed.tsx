import { useEffect, useState } from 'react'
import type { ImageNode } from '@contracts/image-generation'
import { imageTaskElapsed } from './task-elapsed'

export function ImageTaskElapsed({ node }: { node: ImageNode | null }) {
  const [now, setNow] = useState(Date.now)
  const ticking = Boolean(node?.submittedAt && !node.finishedAt && ['generating', 'downloading'].includes(node.status))
  useEffect(() => {
    setNow(Date.now())
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking, node?.submittedAt])
  return <span title="本地请求耗时，不代表服务端生成进度；连接中断不代表远端任务结束">{imageTaskElapsed(node, now)}</span>
}
