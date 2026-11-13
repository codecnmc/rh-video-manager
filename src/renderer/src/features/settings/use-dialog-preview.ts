import { useMutation } from '@tanstack/react-query'
import type { DialogPreview } from '@contracts/window-close'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useDialogPreview(onNotice: (message: string) => void) {
  return useMutation({
    mutationFn: async (kind: DialogPreview) => unwrap(await desktop().previewDialog(kind)),
    onSuccess: (confirmed) => onNotice(`预览已结束：${confirmed ? '点击确认' : '取消或关闭'}，应用继续运行`)
  })
}
