import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePreferences } from '@/features/settings'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useImageCardSize(onNotice: (message: string) => void) {
  const preferences = usePreferences()
  const client = useQueryClient()
  const [localSize, setLocalSize] = useState<number | null>(null)
  const save = useMutation({
    // 快速拖动时按顺序落库，避免较早的请求覆盖最终尺寸。
    scope: { id: 'image-generation-card-size' },
    mutationFn: async (imageGenerationCardSize: number) => unwrap(await desktop().saveAppPreferences({ imageGenerationCardSize })),
    onSuccess: (saved) => { client.setQueryData(['app-preferences'], saved) },
    onError: (error) => onNotice(`缩略图尺寸保存失败：${error.message}`)
  })
  return {
    size: localSize ?? preferences.data?.imageGenerationCardSize ?? 260,
    disabled: !preferences.data,
    error: preferences.error?.message,
    setSize: (size: number) => {
      setLocalSize(size)
      save.mutate(size)
    }
  }
}
