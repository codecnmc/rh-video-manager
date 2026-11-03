import { useEffect, useRef, useState } from 'react'
import { assemblyContentSchema, type AssemblyContent, type AssemblyDocument } from '@contracts/assembly'
import { confirmAction } from '@/components/ui/confirmation'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { currentVersion, pendingSounds } from './assembly-state'
import { totalDuration, soundStart } from '../../../../shared/assembly-timing'
import { assemblyExportOptionsSchema, type AssemblyExportOptions, type AssemblyExportProgress } from '@contracts/assembly-export'

export function useAssemblyExport(options: {
  document: AssemblyDocument; content: AssemblyContent; dirty: boolean; disabled: boolean; externalChanges: boolean
  save: () => Promise<AssemblyDocument | undefined>; onNotice: (message: string) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<AssemblyExportProgress | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const request = useRef<string | null>(null)
  const busy = useRef(false)
  const cancelled = useRef(false)
  function cancel() {
    cancelled.current = true
    if (request.current) {
      setCancelling(true)
      void desktop().cancelAssemblyExport(request.current).then(unwrap).catch(() => {
        setCancelling(false); options.onNotice('取消请求未送达，请稍后重试')
      })
    }
  }
  useEffect(() => {
    const api = desktop()
    if (typeof api.onAssemblyExportProgress !== 'function') return
    return api.onAssemblyExportProgress((update) => { if (update.requestId === request.current) setProgress(update) })
  }, [])
  useEffect(() => () => cancel(), [])
  async function exportVideo(configuration: AssemblyExportOptions) {
    if (options.disabled || busy.current) return
    if (typeof desktop().onAssemblyExportProgress !== 'function') { options.onNotice('导出服务已升级，请在当前任务结束后重启应用再导出'); return }
    const parsedOptions = assemblyExportOptionsSchema.safeParse(configuration)
    if (!parsedOptions.success) { options.onNotice('请检查导出配置'); return }
    const version = currentVersion(options.content)
    if (!version.clips.length) { options.onNotice('请先添加视频片段'); return }
    if (options.externalChanges) { options.onNotice('已有外部新修订，请载入最新版本后再导出'); return }
    if (!assemblyContentSchema.safeParse(options.content).success) { options.onNotice('请先修正片段范围、转场余量、音轨或字幕设置'); return }
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    request.current = requestId
    busy.current = true; cancelled.current = false; setCancelling(false); setExporting(true)
    setProgress({ requestId, stage: 'preparing', percent: 0, stagePercent: null, elapsedSeconds: 0, detail: '确认并保存工程快照' })
    try {
      const pending = pendingSounds(version)
      if (pending && !await confirmAction(`还有 ${pending} 项声音待处理。是否仅导出原声与已绑定音频，暂不包含待处理声音？`)) return
      const end = totalDuration(version)
      if ((version.sounds.some((sound) => sound.state === 'bound' && soundStart(version, sound) + sound.duration > end) || version.captions?.some((caption) => caption.end > end)) &&
        !await confirmAction('部分声音或字幕超出画面末尾。导出以画面总时长为准，超出部分不会进入成片，是否继续？')) return
      if (cancelled.current) return
      const saved = options.dirty ? await options.save() : options.document
      if (!saved || cancelled.current) return
      const result = unwrap(await desktop().exportAssembly({ id: saved.id, projectId: saved.projectId, expectedRevision: saved.revision,
        versionId: saved.activeVersionId, requestId, allowPendingSounds: pending > 0, options: parsedOptions.data }))
      setProgress((previous) => ({ requestId, percent: result ? 100 : previous?.percent ?? 0, stagePercent: result ? 100 : null,
        stage: result ? 'completed' : 'cancelled', detail: result ? '成片已保存' : '导出已取消', elapsedSeconds: (Date.now() - startedAt) / 1000 }))
      options.onNotice(result ? '时间轴成片已导出为 MP4' : '已取消导出')
    } catch (error) {
      const detail = error instanceof Error ? error.message : '导出失败，原素材未改变'
      setProgress((previous) => ({ requestId, percent: previous?.percent ?? 0, stagePercent: null,
        stage: cancelled.current ? 'cancelled' : 'failed', detail, elapsedSeconds: (Date.now() - startedAt) / 1000 }))
      options.onNotice(detail)
    } finally {
      setProgress((previous) => previous && !['completed', 'cancelled', 'failed'].includes(previous.stage)
        ? { ...previous, stage: 'cancelled', detail: '已取消导出', elapsedSeconds: (Date.now() - startedAt) / 1000 } : previous)
      request.current = null; busy.current = false; setExporting(false); setCancelling(false)
    }
  }
  return { exporting, exportVideo, cancel, progress, cancelling, dismissProgress: () => setProgress(null) }
}
