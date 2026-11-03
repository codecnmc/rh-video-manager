import { useState } from 'react'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useCopyAssetImage(onNotice?: (message: string) => void) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function copy(id: string, kind: 'image' | 'id' = 'image') {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      unwrap(await (kind === 'id' ? desktop().copyAssetId(id) : desktop().copyAssetImage(id)))
      const success = kind === 'id' ? '素材库 ID 已复制' : '图片已复制'
      setMessage(success)
      onNotice?.(success)
    } catch (error) {
      const reason = error instanceof Error ? error.message : '复制失败'
      setMessage(reason)
      onNotice?.(reason)
    } finally { setBusy(false) }
  }
  return { copy, busy, message }
}
