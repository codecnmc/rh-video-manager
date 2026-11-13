import { useMutation, useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { confirmAction } from '@/components/ui/confirmation'

export function useMediaStorage(onNotice: (message: string) => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: 'choose' | 'cancel' | 'restart') => {
      if (action === 'choose') {
        const confirmed = await confirmAction('选择目标父目录后，会在其中新建独立的素材目录。\n\n重启时复制图片、音频、成片及采样，逐个校验后切换位置，再清理旧副本。迁移失败会保留原位置。\n\n数据库、账号和日志不移动。本次选择完成后不会立即迁移。', undefined,
          { title: '更改素材存储位置', confirmLabel: '选择迁移位置' })
        if (!confirmed) return null
        return unwrap(await desktop().chooseMediaStorageDirectory())
      }
      if (action === 'cancel') return unwrap(await desktop().cancelMediaStorageChange())
      const information = unwrap(await desktop().appInformation())
      const manualRestart = information.manualRestartRequired
      if (!await confirmAction(manualRestart
        ? '当前通过开发模式运行，需要退出后重新运行 pnpm dev。\n\n素材位置计划已保存，下次启动时执行迁移或清理。请先保存编辑内容；文件较多时启动可能需要更长时间。'
        : '请先保存编辑内容。应用将重启，执行素材迁移或清理旧副本。\n\n文件较多时启动可能需要更长时间，请勿强制结束应用。', undefined,
        { title: manualRestart ? '退出后重新启动工作台' : '重启并迁移素材', confirmLabel: manualRestart ? '保存完毕，退出' : '保存完毕，重启' })) return null
      return unwrap(await desktop().restartForMediaStorage())
    },
    onSuccess: async (result, action) => {
      await client.invalidateQueries({ queryKey: ['app-information'] })
      if (result && action === 'choose') onNotice('待迁移位置已设置，重启后迁移素材')
      if (action === 'cancel') onNotice('已取消位置更改，目标目录内的文件未删除')
    }
  })
}
