import { useMutation, useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useMediaStorage(onNotice: (message: string) => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: 'choose' | 'cancel' | 'restart') => {
      if (action === 'choose') return unwrap(await desktop().chooseMediaStorageDirectory())
      if (action === 'cancel') return unwrap(await desktop().cancelMediaStorageChange())
      return unwrap(await desktop().restartForMediaStorage())
    },
    onSuccess: async (result, action) => {
      await client.invalidateQueries({ queryKey: ['app-information'] })
      if (result && action === 'choose') onNotice('待迁移位置已设置，重启后迁移素材')
      if (action === 'cancel') onNotice('已取消位置更改，目标目录内的文件未删除')
    }
  })
}
