import { app, dialog } from 'electron'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { assemblyScopeSchema, saveAssemblySchema, exportAssemblySchema, assemblyWindowTargetSchema, assemblySelectionSchema } from '../../shared/contracts/assembly'
import type { AssemblyWindowState, AssemblyWindowTarget } from '../../shared/contracts/assembly'
import type { SettingsService } from '../modules/settings'
import type { AssemblyService, AssemblyExportService, AssemblyRenderer } from '../modules/assembly'
import type { DesktopHandle } from './handle'
import type { MediaEngine } from '../application/media-engine'
import { selectMediaEngine } from './select-media-engine'
import type { AssemblyRenderProgress } from '../../shared/contracts/assembly-export'

export interface AssemblyWindowHost {
  state(owner: number): AssemblyWindowState
  hasProject(projectId: string | null): boolean
  assertEditable(projectId: string | null, owner: number): void
  open(target: AssemblyWindowTarget, owner: number): Promise<void>
}

export function registerAssembly(handle: DesktopHandle, assembly: AssemblyService, exporter?: AssemblyExportService,
  createRenderer?: (ffmpeg: string, ffprobe: string) => AssemblyRenderer, mediaEngine?: MediaEngine,
  windows?: AssemblyWindowHost, settings?: SettingsService, assertProject?: (projectId: string | null) => Promise<void>): void {
  let active: { requestId: string; owner: number; controller: AbortController } | undefined
  app.once('will-quit', () => active?.controller.abort())
  handle('assembly:list', async (input) => assembly.list(assemblyScopeSchema.parse(input).projectId))
  handle('assembly:window-state', async (_input, window) => windows?.state(window.id) ?? { context: null, locks: [] })
  handle('assembly:open-window', async (input, window) => {
    const target = assemblyWindowTargetSchema.parse(input)
    if (!windows) throw new Error('独立剪辑窗口尚未配置')
    await assertProject?.(target.projectId)
    assembly.get(target.id, target.projectId)
    if (active && !windows.hasProject(target.projectId)) throw new Error('请先完成或取消当前导出，再打开独立窗口')
    await windows.open(target, window.id)
  })
  handle('assembly:selection', async (input) => {
    const { projectId } = assemblyScopeSchema.parse(input)
    return settings?.preferences().assemblySelections?.[projectId ?? 'public'] ?? null
  })
  handle('assembly:select', async (input, window) => {
    const parsed = assemblySelectionSchema.parse(input)
    windows?.assertEditable(parsed.projectId, window.id)
    if (parsed.id) assembly.get(parsed.id, parsed.projectId)
    if (!settings) throw new Error('剪辑界面偏好尚未配置')
    settings.save({ assemblySelections: { ...settings.preferences().assemblySelections, [parsed.projectId ?? 'public']: parsed.id } })
  })
  handle('assembly:save', async (input, window) => {
    const parsed = saveAssemblySchema.parse(input)
    windows?.assertEditable(parsed.projectId, window.id)
    return assembly.save(parsed)
  })
  handle('assembly:cancel-export', async (input, window) => {
    const { requestId } = z.object({ requestId: z.string().uuid() }).parse(input)
    if (active?.requestId === requestId && active.owner === window.id) active.controller.abort()
  })
  handle('assembly:export', async (input, window) => {
    const parsed = exportAssemblySchema.parse(input)
    windows?.assertEditable(parsed.projectId, window.id)
    if (!exporter || !createRenderer || !mediaEngine) throw new Error('本地导出服务未配置')
    if (active) throw new Error('已有成片正在导出，请等待完成或取消')
    exporter.prepare(parsed)
    const controller = new AbortController()
    active = { requestId: parsed.requestId, owner: window.id, controller }
    const onClosed = () => controller.abort()
    const onClose = (event: { preventDefault(): void }) => {
      if (controller.signal.aborted) return
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning', title: '正在导出成片', message: '关闭窗口将取消当前导出，是否继续？',
        buttons: ['继续导出', '取消导出并关闭'], defaultId: 0, cancelId: 0
      })
      if (choice === 0) event.preventDefault()
    }
    window.on('close', onClose)
    window.once('closed', onClosed)
    const startedAt = Date.now()
    let last: AssemblyRenderProgress = { stage: 'preparing', detail: '准备导出', percent: 0, stagePercent: null }
    const publish = (progress: AssemblyRenderProgress) => {
      last = { ...progress, percent: Math.max(last.percent, progress.percent) }
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('assembly:export-progress', {
        ...last, requestId: parsed.requestId, elapsedSeconds: Math.max(0, (Date.now() - startedAt) / 1000)
      })
    }
    // 原生选文件、慢磁盘和编码阻塞期间仍更新耗时，但不伪造媒体处理进度。
    const heartbeat = setInterval(() => publish(last), 1000)
    let completed = false
    try {
      publish({ ...last, detail: '检查本地媒体引擎' })
      const engine = await selectMediaEngine(mediaEngine, window, controller.signal)
      controller.signal.throwIfAborted()
      if (!engine) return false
      const document = assembly.get(parsed.id, parsed.projectId)
      const filename = `${document.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)}.mp4`
      publish({ ...last, detail: '等待选择成片保存位置' })
      const selected = await dialog.showSaveDialog(window, { title: '导出时间轴成片', defaultPath: filename, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
      controller.signal.throwIfAborted()
      if (selected.canceled || !selected.filePath) return false
      const target = /\.mp4$/i.test(selected.filePath) ? selected.filePath : `${selected.filePath}.mp4`
      if (target !== selected.filePath && await stat(target).then(() => true, () => false)) {
        const overwrite = await dialog.showMessageBox(window, { type: 'warning', title: '确认替换成片', message: '同名 MP4 文件已存在，是否替换？', buttons: ['取消', '替换'], defaultId: 0, cancelId: 0 })
        if (overwrite.response !== 1) return false
      }
      await exporter.export(parsed, target, createRenderer(engine.ffmpeg, engine.ffprobe), controller.signal, publish)
      completed = true
      publish({ stage: 'completed', detail: '成片已保存', percent: 100, stagePercent: 100 })
      return true
    } catch (error) {
      completed = true
      publish({ stage: controller.signal.aborted ? 'cancelled' : 'failed', detail: controller.signal.aborted ? '导出已取消' : '导出失败，请查看错误提示', percent: last.percent, stagePercent: null })
      if (controller.signal.aborted) throw new Error('导出已取消')
      throw error
    } finally {
      clearInterval(heartbeat)
      if (!completed) publish({ ...last, stage: 'cancelled', detail: '已取消选择，未导出' })
      window.removeListener('closed', onClosed)
      window.removeListener('close', onClose)
      active = undefined
    }
  })
}
