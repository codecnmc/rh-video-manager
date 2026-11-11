import { registerVoices } from './register-voices'
import type { VoiceService } from '../modules/voices'
import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { downloadPreviewSchema, previewActionSchema, refreshGenerationResultsSchema, taskOutputActionSchema, releaseReservationSchema } from '../../shared/contracts/preview'
import type { PreviewMedia } from '../../shared/contracts/preview'
import { copyVideoDraftSchema, deleteWorkspaceEntitySchema, saveWorkspaceSchema } from '../../shared/contracts/workspace'
import type { Result } from '../../shared/contracts/desktop'
import type { WorkspaceService } from '../application/workspace-service'
import type { PreviewService, GenerationService } from '../modules/jobs'
import { scheduleGenerationSchema, submitGenerationSchema } from '../../shared/contracts/generation'
import { consumptionFilterSchema } from '../../shared/contracts/consumption'
import { downloadPreview, exportManagedVideo } from '../infrastructure/files/download-preview'
import { generatedVideoName } from '../../shared/media-naming'
import { entityIdSchema, saveAccountSchema } from '../../shared/contracts/accounts'
import { inspectWorkflowSchema, saveWorkflowSchema, workflowTemplateSchema } from '../../shared/contracts/workflows'
import { importReferencesSchema, draftReferencesSchema, pasteReferenceImagesSchema, replaceDraftReferenceSchema } from '../../shared/contracts/references'
import { attachAssetSchema } from '../../shared/contracts/assets'
import type { AccountService } from '../modules/accounts'
import type { WorkflowService } from '../modules/workflows'
import type { ReferenceService, LibraryService } from '../modules/assets'
import type { AssetMcpServer } from '../mcp/asset-server'
import { registerLibrary } from './register-library'
import { referenceExtensions } from '../infrastructure/files/reference-files'
import type { ExtensionService, ExtensionPageService } from '../modules/extensions'
import { registerExtensions } from './register-extensions'
import type { ProductionService } from '../modules/production'
import { registerProduction } from './register-production'
import type { ScriptLibraryService } from '../modules/scripts'
import type { SettingsService } from '../modules/settings'
import { registerPersonalLibrary } from './register-personal-library'
import { registerAssembly } from './register-assembly'
import type { AssemblyWindowHost } from './register-assembly'
import type { AssemblyService, AssemblyExportService, AssemblyRenderer } from '../modules/assembly'
import type { MediaEngine } from '../application/media-engine'
import { selectMediaEngine } from './select-media-engine'
import { registerDelivery } from './register-delivery'
import type { MigrationService } from '../modules/migration'
import type { BuiltinSkillService } from '../modules/skills'
import type { ImageGenerationService } from '../modules/image-generation'
import { registerImageGeneration } from './register-image-generation'
import { registerWorkbenchWindows, type WorkbenchWindowHost } from './register-workbench-windows'
import { registerWindowClose, type WindowClosePromptHost } from './register-window-close'

export function registerWorkbench(workspace: WorkspaceService, previews: PreviewService, allowedUrl: (url: string) => boolean,
  accounts: AccountService, workflows: WorkflowService, references: ReferenceService, library: LibraryService, mcp: AssetMcpServer,
  extensions: ExtensionService, production: ProductionService, generation: GenerationService,
  prepareDownload: (media: PreviewMedia) => PreviewMedia = (media) => media,
  readTaskDiagnostics: (id: string) => string = () => { throw new Error('任务日志尚未配置') },
  personalLibrary?: { library: ScriptLibraryService; settings: SettingsService; pages: ExtensionPageService; assembly?: AssemblyService; assemblyExport?: AssemblyExportService; assemblyRenderer?: (ffmpeg: string, ffprobe: string) => AssemblyRenderer;
    voices?: VoiceService; mediaEngine?: MediaEngine; migration?: MigrationService; skills?: BuiltinSkillService; images?: ImageGenerationService; assemblyWindows?: AssemblyWindowHost; workbenchWindows?: WorkbenchWindowHost; closePrompts?: WindowClosePromptHost }): void {
  const handle = <T>(channel: string, action: (input: unknown, window: BrowserWindow) => Promise<T>) => {
    ipcMain.handle(channel, async (event, input: unknown): Promise<Result<T>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const frame = event.senderFrame
      const developmentUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
      const expected = developmentUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
      if (!window || !frame || frame !== event.sender.mainFrame || !expected || new URL(frame.url).href.split('#')[0] !== new URL(expected).href.split('#')[0]) {
        return { ok: false, error: '请求来源不受信任' }
      }
      try { personalLibrary?.migration?.assertAvailable(); return { ok: true, value: await action(input, window) } }
      catch (error) {
        if (error instanceof z.ZodError) return { ok: false, error: '输入格式不正确，请检查字段内容' }
        // 不向 renderer 返回网络异常、URL 或凭据；业务异常仅使用本地固定提示。
        return { ok: false, error: error instanceof Error && !/fetch|https?:|wss?:/i.test(error.message) ? error.message : '操作未完成，请稍后重试' }
      }
    })
  }
  if (personalLibrary?.voices) registerVoices(handle, personalLibrary.voices)
  handle('workspace:load', () => workspace.load())
  if (personalLibrary?.closePrompts) registerWindowClose(handle, personalLibrary.closePrompts)
  handle('generation:schedule', (input) => generation.schedule(scheduleGenerationSchema.parse(input)))
  handle('workspace:save', (input) => workspace.save(saveWorkspaceSchema.parse(input)))
  handle('workspace:copy-video', (input) => workspace.copyVideoDraft(copyVideoDraftSchema.parse(input)))
  handle('workspace:delete', async (input) => {
    const parsed = deleteWorkspaceEntitySchema.parse(input)
    if (parsed.kind === 'project' && personalLibrary?.assemblyWindows?.hasProject(parsed.projectId)) throw new Error('此项目仍在独立剪辑窗口中打开，请先关闭该窗口再删除项目')
    if (parsed.kind === 'project' && personalLibrary?.images?.hasPending(parsed.projectId)) throw new Error('仍有未结束或受理不明的图片任务，不能删除所属项目')
    if (parsed.kind !== 'episode' && generation.hasPending(parsed.projectId, parsed.kind === 'video' ? parsed.id : undefined)) {
      throw new Error('仍有未完成或受理不明的视频任务，不能删除所属项目或草稿')
    }
    if (parsed.kind !== 'episode' && production.hasPending(parsed.projectId, parsed.kind === 'video' ? parsed.id : undefined)) {
      throw new Error('仍有未完成的台词任务，请先取消或等待完成再删除')
    }
    if (parsed.kind !== 'episode' && previews.list().some((task) => task.projectId === parsed.projectId &&
      (parsed.kind === 'project' || task.draftId === parsed.id) && !['success', 'failed', 'cancelled'].includes(task.remoteStatus))) {
      throw new Error('仍有未结束或状态未知的远端任务，请先确认任务终止再删除')
    }
    const updated = await workspace.remove(parsed)
    if (parsed.kind === 'project' && mcp.status().projectId === parsed.projectId) mcp.stop()
    for (const task of previews.list()) {
      if (task.projectId === parsed.projectId && (parsed.kind === 'project' || parsed.kind === 'video' && task.draftId === parsed.id)) previews.disconnect(task.id)
    }
    return updated
  })
  registerLibrary(handle, library, workspace, mcp, personalLibrary?.settings)
  registerExtensions(handle, extensions, workspace, personalLibrary?.pages)
  registerProduction(handle, production)
  if (personalLibrary?.images) registerImageGeneration(handle, personalLibrary.images)
  if (personalLibrary?.workbenchWindows) registerWorkbenchWindows(handle, workspace, personalLibrary.settings, personalLibrary.workbenchWindows, personalLibrary.images)
  if (personalLibrary?.migration && personalLibrary.skills) registerDelivery(handle, personalLibrary.migration, personalLibrary.skills)
  if (personalLibrary) registerPersonalLibrary(handle, personalLibrary.library, personalLibrary.settings)
  if (personalLibrary?.assembly) registerAssembly(handle, personalLibrary.assembly, personalLibrary.assemblyExport, personalLibrary.assemblyRenderer, personalLibrary.mediaEngine,
    personalLibrary.assemblyWindows, personalLibrary.settings, async (projectId) => {
      if (projectId && !(await workspace.load()).projects.some((project) => project.id === projectId)) throw new Error('项目已不可用')
    })
  handle('accounts:list', async () => accounts.list())
  handle('accounts:save', async (input) => {
    const parsed = saveAccountSchema.parse(input)
    if (parsed.id && generation.hasPending(undefined, undefined, parsed.id)) throw new Error('该账号仍有未完成或受理不明的视频任务，暂不能修改账号配置')
    return accounts.save(parsed)
  })
  handle('accounts:delete', async (input) => {
    const { id } = entityIdSchema.parse(input)
    if (generation.hasPending(undefined, undefined, id)) throw new Error('该账号仍有未完成或受理不明的视频任务，不能删除')
    if (previews.list().some((preview) => preview.accountId === id && preview.connection !== 'completed')) throw new Error('请先移除该账号的任务监听，再删除账号配置')
    if (workflows.list().some((workflow) => workflow.accountId === id)) throw new Error('请先删除该账号的工作流配置，再删除账号')
    return accounts.remove(id)
  })
  handle('accounts:refresh', async (input) => accounts.refresh(z.object({ id: z.string().uuid().nullable() }).parse(input).id))
  handle('workflows:list', async () => workflows.list())
  handle('workflows:export-template', async (input, window) => {
    const { template } = z.object({ template: workflowTemplateSchema.default('standard') }).parse(input ?? {})
    const content = workflows.exportTemplate(template)
    const selected = await dialog.showSaveDialog(window, { title: template === 'accelerated' ? '下载加速版工作流' : '下载标准版工作流', defaultPath: template === 'accelerated' ? 'H3全能参考工作流-加速版.json' : 'H3全能参考工作流-无通知.json',
      filters: [{ name: 'ComfyUI 工作流', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePath) return false
    try { await writeFile(selected.filePath, content, 'utf8') }
    catch { throw new Error('工作流保存失败，请检查保存位置和磁盘空间') }
    return true
  })
  handle('workflows:save', async (input) => {
    const parsed = saveWorkflowSchema.parse(input)
    if (parsed.id && generation.hasPending(undefined, undefined, undefined, parsed.id)) throw new Error('该工作流仍有未完成或受理不明的视频任务，暂不能修改')
    if (!accounts.list().accounts.some((account) => account.id === parsed.accountId)) throw new Error('所属账号不存在')
    return workflows.saveAndInspect(parsed, accounts.credential(parsed.accountId))
  })
  handle('workflows:delete', async (input) => {
    const { id } = entityIdSchema.parse(input)
    if (generation.hasPending(undefined, undefined, undefined, id)) throw new Error('该工作流仍有未完成或受理不明的视频任务，不能删除')
    return workflows.remove(id)
  })
  handle('workflows:inspect', async (input) => {
    const { id } = inspectWorkflowSchema.parse(input)
    const workflow = workflows.get(id)
    if (!workflow.accountId) throw new Error('请先为工作流配置所属账号')
    return workflows.inspect(id, accounts.credential(workflow.accountId))
  })
  const savedDraft = async (id: string) => {
    const current = await workspace.load()
    const project = current.projects.find((item) => item.videoDrafts.some((draft) => draft.id === id))
    const draft = project?.videoDrafts.find((item) => item.id === id)
    if (!project || !draft) throw new Error('视频草稿不存在，请先保存')
    return { project, draft }
  }
  handle('references:list', async (input) => {
    const { draftId } = draftReferencesSchema.parse(input)
    await savedDraft(draftId)
    return references.list(draftId)
  })
  handle('references:import', async (input, window) => {
    const { draftId, kind } = importReferencesSchema.parse(input)
    const { project } = await savedDraft(draftId)
    const selection = await dialog.showOpenDialog(window, { title: '添加参考素材', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '参考素材', extensions: referenceExtensions[kind] }] })
    if (selection.canceled) return references.list(draftId)
    references.capacity(draftId, kind, selection.filePaths.length)
    const imported = await library.import({ projectId: project.id, categoryId: null, tags: [], prompt: '', notes: '', kind }, selection.filePaths)
    for (const asset of imported) references.attach(draftId, project.id, asset.id)
    return references.list(draftId)
  })
  handle('references:attach', async (input) => {
    const { draftId, assetId } = attachAssetSchema.parse(input)
    const { project } = await savedDraft(draftId)
    return references.attach(draftId, project.id, assetId)
  })
  handle('references:replace', async (input) => {
    const parsed = replaceDraftReferenceSchema.parse(input)
    const { project } = await savedDraft(parsed.draftId)
    return references.replace(parsed, project.id)
  })
  handle('references:paste-images', async (input) => {
    const { draftId, images } = pasteReferenceImagesSchema.parse(input)
    const { project, draft } = await savedDraft(draftId)
    return references.importImages(draftId, project.id, draft.title, images)
  })
  handle('references:remove', async (input) => {
    const { id } = entityIdSchema.parse(input)
    const reference = references.get(id)
    const { draft } = await savedDraft(reference.draftId)
    if (draft.prompt.includes(reference.label)) throw new Error('请先移除提示词中的对应引用并保存，再解除素材关联')
    references.detach(id)
  })
  handle('references:reveal', async (input) => { references.reveal(entityIdSchema.parse(input).id) })
  handle('window:maximized', async (_input, window) => window.isMaximized())
  handle('window:action', async (input, window) => {
    const { action } = z.object({ action: z.enum(['minimize', 'maximize', 'close']) }).parse(input)
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize() }
    if (action === 'close') window.close()
    return !window.isDestroyed() && window.isMaximized()
  })
  handle('generation:submit', async (input) => generation.submit(submitGenerationSchema.parse(input)))
  handle('generation:consumption-ledger', async (input) => generation.consumptionLedger(consumptionFilterSchema.parse(input)))
  handle('generation:refresh-consumption', async (input) => generation.refreshConsumption(previewActionSchema.parse(input).id))
  handle('generation:retry-final-archive', async (input, window) => {
    const { id } = previewActionSchema.parse(input)
    const task = generation.list().find((item) => item.id === id)
    if (!task) throw new Error('任务记录不存在')
    if (task.continuityReference?.status === 'failed' && personalLibrary?.mediaEngine) {
      if (!await selectMediaEngine(personalLibrary.mediaEngine, window)) return
    }
    generation.retryFinalArchive(id)
  })
  handle('generation:release-reservation', async (input) => generation.releaseReservation(releaseReservationSchema.parse(input)))
  handle('generation:confirm-cancellation', async (input) => generation.confirmCancellation(releaseReservationSchema.parse(input)))
  handle('preview:export-diagnostics', async (input, window) => {
    const { id } = previewActionSchema.parse(input)
    const task = generation.list().find((item) => item.id === id)
    if (!task) throw new Error('任务记录不存在')
    const content = readTaskDiagnostics(id)
    const selected = await dialog.showSaveDialog(window, { title: '导出任务诊断日志', defaultPath: `video-task-${task.taskId || id}.jsonl`,
      filters: [{ name: 'JSON Lines 日志', extensions: ['jsonl'] }] })
    if (selected.canceled || !selected.filePath) return false
    try { await writeFile(selected.filePath, content, 'utf8') }
    catch { throw new Error('日志导出失败，请检查保存位置和磁盘空间') }
    return true
  })
  handle('generation:refresh-results', async (input) => {
    const parsed = refreshGenerationResultsSchema.parse(input)
    return generation.refreshResults(parsed.id, parsed.workflowUnchangedConfirmed)
  })
  handle('preview:output-action', async (input) => {
    const { id, index, action } = taskOutputActionSchema.parse(input)
    const task = previews.list().find((item) => item.id === id) ?? generation.list().find((item) => item.id === id)
    const media = task?.resultVideos?.[index]
    if (!media || !allowedUrl(media.source)) throw new Error('该平台视频地址不可用，请重新获取结果')
    if (action === 'download') return downloadPreview(media, allowedUrl)
    clipboard.writeText(media.source)
    return true
  })
  handle('preview:list', async () => {
    generation.resume()
    const jobs = generation.list()
    return [...jobs, ...previews.list().filter((task) => !jobs.some((job) => job.id === task.id))]
  })
  handle('preview:disconnect', async (input) => {
    const { id } = previewActionSchema.parse(input)
    const job = generation.list().find((item) => item.id === id)
    if (job && !job.manualCancellationConfirmedAt && !['success', 'failed', 'cancelled'].includes(job.remoteStatus)) throw new Error('生成任务尚未确认终态，不能移除可靠性监听')
    if (previews.list().some((task) => task.id === id)) previews.disconnect(id)
  })
  handle('preview:cancel', async (input) => { await previews.get(previewActionSchema.parse(input).id).cancel() })
  handle('preview:download', async (input) => {
    const { id, kind } = downloadPreviewSchema.parse(input)
    const saved = generation.list().find((task) => task.id === id)
    if (kind === 'final' && saved?.finalArchive?.status === 'ready' && saved.finalArchive.assetId && saved.finalArchive.source === saved.final?.source) {
      const asset = library.get(saved.finalArchive.assetId)
      return exportManagedVideo(library.media(asset.id).path, asset.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'))
    }
    const media = (previews.list().find((task) => task.id === id) ?? generation.list().find((task) => task.id === id))?.[kind]
    if (!media) throw new Error('该预览尚未生成')
    return downloadPreview(prepareDownload(media), allowedUrl, kind === 'final' ? generatedVideoName('最终成片', id, saved?.submittedAt ?? media.receivedAt) : undefined)
  })
  handle('preview:copy-url', async (input) => {
    const { id, kind } = downloadPreviewSchema.parse(input)
    const media = (previews.list().find((task) => task.id === id) ?? generation.list().find((task) => task.id === id))?.[kind]
    if (!media || !allowedUrl(media.source)) throw new Error('该预览没有可复制的媒体地址')
    clipboard.writeText(media.source)
  })
}
