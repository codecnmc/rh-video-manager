import { VoiceService } from '../modules/voices'
import { app, BrowserWindow, dialog, Notification } from 'electron'
import { WindowClosePrompts } from './window-close-prompts'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SqliteWorkspaceRepository, WorkbenchDatabase } from '../infrastructure/database/workspace-repository'
import { SqliteProjectRepository } from '../infrastructure/database/project-repository'
import { SqliteScriptRepository } from '../infrastructure/database/script-repository'
import { WorkspaceService } from '../application/workspace-service'
import { WorkspaceDraftService } from '../application/workspace-draft-service'
import { ProjectService } from '../modules/projects'
import { ScriptService, ScriptLibraryService } from '../modules/scripts'
import { SqliteScriptLibraryRepository } from '../infrastructure/database/script-library-repository'
import { MediaStorageService, SettingsService } from '../modules/settings'
import { SqliteMediaStorageRepository } from '../infrastructure/database/media-storage-repository'
import { LocalMediaStorageFiles } from '../infrastructure/files/media-storage-files'
import { SqlitePreferencesRepository } from '../infrastructure/database/preferences-repository'
import { LocalSettingsEnvironment } from '../infrastructure/files/settings-environment'
import { createWorkspace } from './create-workspace'
import { PreviewService, GenerationService } from '../modules/jobs'
import { SqliteGenerationRepository } from '../infrastructure/database/generation-repository'
import { RunningHubGenerationGateway } from '../providers/runninghub/generation-gateway'
import { RunningHubPreviewSession } from '../providers/runninghub/preview-session'
import { allowedMediaUrl } from '../providers/runninghub/preview-protocol'
import { registerWorkbench } from '../ipc/register-workbench'
import { AccountService } from '../modules/accounts'
import { WorkflowService } from '../modules/workflows'
import h3ComfyUiTemplate from '../providers/runninghub/h3-comfyui-template.json' with { type: 'json' }
import h3AcceleratedTemplate from '../providers/runninghub/h3-accelerated-template.json' with { type: 'json' }
import { ReferenceService, LibraryService } from '../modules/assets'
import { VideoService } from '../modules/video'
import { SqliteVideoDraftRepository } from '../infrastructure/database/video-repository'
import { SqliteAssetRepository } from '../infrastructure/database/asset-repository'
import { registerAssetProtocol } from '../infrastructure/files/asset-protocol'
import { AssetMcpServer } from '../mcp/asset-server'
import { FfmpegMediaInspector } from '../infrastructure/files/ffmpeg-media-inspector'
import { SqliteMcpTokenStore } from '../infrastructure/security/mcp-token-store'
import { SqliteAccountRepository } from '../infrastructure/database/account-repository'
import { SqliteWorkflowRepository } from '../infrastructure/database/workflow-repository'
import { SqliteReferenceRepository } from '../infrastructure/database/reference-repository'
import { SafeStorageCredentialVault } from '../infrastructure/security/credential-vault'
import { ManagedReferenceFiles } from '../infrastructure/files/reference-files'
import { RunningHubAccountGateway } from '../providers/runninghub/account-gateway'
import { RunningHubWorkflowGateway } from '../providers/runninghub/workflow-gateway'
import { ExtensionService, ExtensionPageService } from '../modules/extensions'
import { SqliteExtensionRepository } from '../infrastructure/database/extension-repository'
import { ManagedExtensionPackages } from '../infrastructure/extensions/package-store'
import { UtilityExtensionHost } from '../infrastructure/extensions/process-host'
import { SafeStorageExtensionVault } from '../infrastructure/security/extension-vault'
import { extensionHostEntry } from '../infrastructure/extensions/host-path'
import { ProductionService } from '../modules/production'
import { SqliteProductionRepository } from '../infrastructure/database/production-repository'
import { ManagedProductionAudio } from '../infrastructure/files/production-audio'
import { ManagedSamplingFiles } from '../infrastructure/files/sampling-files'
import { TaskDiagnostics } from '../infrastructure/files/task-diagnostics'
import { ManagedFinalVideoFiles } from '../infrastructure/files/final-video-files'
import { AssemblyService, AssemblyExportService } from '../modules/assembly'
import { SqliteAssemblyRepository } from '../modules/assembly/adapters/sqlite-assembly-repository'
import { FfmpegAssemblyRenderer } from '../modules/assembly/adapters/ffmpeg-assembly-renderer'
import { FfmpegContinuityFiles } from '../modules/jobs/adapters/ffmpeg-continuity-files'
import { SqliteContinuityEngineRepository } from '../infrastructure/database/continuity-engine-repository'
import { LocalMediaEngine } from '../infrastructure/files/media-engine'
import { startRememberedMcp } from '../application/start-remembered-mcp'
import { MigrationService, EncryptedMigrationArchive } from '../modules/migration'
import { BuiltinSkillService, LocalBuiltinSkillFiles } from '../modules/skills'
import { createTaskNotification } from '../application/task-notification'
import type { PreviewKind, PreviewState } from '../../shared/contracts/preview'
import { ImageGenerationService } from '../modules/image-generation'
import { SqliteImageGenerationRepository } from '../modules/image-generation/adapters/sqlite-image-generation-repository'
import { ProtocolImageGateway } from '../modules/image-generation/adapters/image-gateway'
import { OpenAiImageProtocol } from '../modules/image-generation/adapters/openai-image-protocol'
import { LocalImageOutputStore } from '../modules/image-generation/adapters/image-output-store'
import { AssemblyWindows } from './assembly-windows'
import { createWindow } from './create-window'
import { WorkbenchWindows } from './workbench-windows'

export async function initializeWorkbench(): Promise<void> {
  const directory = join(app.getPath('userData'), 'database')
  mkdirSync(directory, { recursive: true })
  const database = new WorkbenchDatabase(join(directory, 'workbench.sqlite'))
  let imageGeneration: ImageGenerationService | undefined
  const projects = new ProjectService(new SqliteProjectRepository(database.connection))
  const scripts = new ScriptService(new SqliteScriptRepository(database.connection))
  const personalLibrary = new ScriptLibraryService(new SqliteScriptLibraryRepository(database.connection), randomUUID)
  const mediaStorage = new MediaStorageService(new SqliteMediaStorageRepository(database.connection), new LocalMediaStorageFiles(), app.getPath('userData'), () => {
    if (library.hasPendingImports() || imageGeneration?.hasPending() || imageGeneration?.hasActivity() || generation?.hasStorageActivity() || production.hasStorageActivity() || assemblyExport.hasActivity() ||
      previews.list().some((task) => !['success', 'failed', 'cancelled'].includes(task.remoteStatus))) {
      throw new Error('仍有导入、视频任务、音频任务、成片下载或导出未结束，请结束后再更改素材位置或重启迁移')
    }
  })
  // 所有文件适配器和任务恢复之前迁移，旧路径不再有进程内写入。
  await mediaStorage.initialize()
  const mediaDirectory = mediaStorage.status().directory
  const settings = new SettingsService(new SqlitePreferencesRepository(database.connection), new LocalSettingsEnvironment(() => mediaDirectory), mediaStorage)
  const videos = new VideoService(new SqliteVideoDraftRepository(database.connection))
  const repository = new SqliteWorkspaceRepository(database.connection, projects, scripts, videos,
    (source, target, projectId) => references.copy(source, target, projectId))
  const workspace = new WorkspaceService(repository, createWorkspace)
  let generation: GenerationService | undefined
  const settledAccounts = new Set<string>()
  const diagnostics = new TaskDiagnostics(join(app.getPath('userData'), 'logs'))
  const observedTasks = new Map<string, string>()
  const samplingNotifications = new Set<string>()
  const samplingProgress = new Map<string, { step: number; total: number }>()
  const samplingMedia = new Set<string>()
  const notificationTasks = new Map<string, Pick<PreviewState, 'id' | 'projectId' | 'draftId' | 'taskId'>>()
  const activeNotifications = new Set<Notification>()
  const notify = async (id: string, message: string, kind?: PreviewKind) => {
    try {
      if (!settings.preferences().taskNotifications || !Notification.isSupported()) return
      const task = notificationTasks.get(id)
      if (!task) return
      const current = await workspace.load()
      if (!settings.preferences().taskNotifications) return
      const content = createTaskNotification(task, current.projects, message, kind)
      const notification = new Notification({ title: content.title, body: content.body,
        icon: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'alpaca.png') })
      activeNotifications.add(notification)
      notification.once('close', () => activeNotifications.delete(notification))
      notification.once('failed', () => activeNotifications.delete(notification))
      notification.once('click', () => {
        activeNotifications.delete(notification)
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
        if (!window || window.isDestroyed()) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.webContents.send('preview:open', content.target)
      })
      notification.show()
    } catch { /* 系统通知失败不能中断任务落库和状态广播。 */ }
  }
  const emitPreview = (event: import('../../shared/contracts/preview').PreviewEvent) => {
    if (event.type === 'state') {
      const { id, projectId, draftId, taskId } = event.state
      notificationTasks.set(id, { id, projectId, draftId, taskId })
      const previous = observedTasks.get(event.state.id)
      const status = event.state.remoteStatus
      observedTasks.set(event.state.id, status)
      samplingProgress.set(event.state.id, { step: event.state.samplingStep, total: event.state.samplingTotal })
      // 初次恢复快照不弹出历史通知；仅通知本次观察到的终态变化。
      if (previous && !['success', 'failed', 'cancelled'].includes(previous) && ['success', 'failed', 'cancelled'].includes(status)) {
        void notify(event.state.id, status === 'success' ? '视频任务已完成' : status === 'cancelled' ? '视频任务已取消' : '视频任务生成失败')
      }
    } else if (event.kind === 'sampling') {
      samplingMedia.add(event.id)
    }
    const id = event.type === 'state' ? event.state.id : event.id
    const progress = samplingProgress.get(id)
    // 步数到达末步且已收到实际媒体才提醒；历史恢复只有状态广播，不补弹旧采样。
    if (samplingMedia.has(id) && progress && progress.total > 0 && progress.step >= progress.total && !samplingNotifications.has(id)) {
      samplingNotifications.add(id)
      void notify(id, '实时采样已完成，可以查看采样预览；最终成片仍以任务状态为准', 'sampling')
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('preview:event', event)
    }
  }
  const previews: PreviewService = new PreviewService((options) => new RunningHubPreviewSession({ ...options, diagnose: (entry) => diagnostics.append(entry) }), (event) => {
    emitPreview(generation?.onPreview(event) ?? event)
    if (event.type === 'state' && event.state.connection === 'completed' &&
      (event.state.remoteStatus === 'success' || event.state.remoteStatus === 'failed' || event.state.remoteStatus === 'cancelled') && !settledAccounts.has(event.state.id)) {
      settledAccounts.add(event.state.id)
      // 仅同步原账号；同步失败不改变任务终态，不重提任务。
      void accounts.refresh(event.state.accountId).then(() => {
        const { sampling: _sampling, draft: _draft, final: _final, ...state } = generation?.list().find((task) => task.id === event.state.id) ?? previews.get(event.state.id).snapshot()
        emitPreview({ type: 'state', state })
      }).catch(() => undefined)
    }
  })
  const accounts = new AccountService(new SqliteAccountRepository(database.connection), new SafeStorageCredentialVault(), new RunningHubAccountGateway(), randomUUID)
  const workflows = new WorkflowService(new SqliteWorkflowRepository(database.connection), new RunningHubWorkflowGateway(), randomUUID,
    JSON.stringify(h3ComfyUiTemplate, null, 2), JSON.stringify(h3AcceleratedTemplate, null, 2))
  const assembly = new AssemblyService(new SqliteAssemblyRepository(database.connection), { get: (id) => library.get(id) }, randomUUID)
  const library: LibraryService = new LibraryService(new SqliteAssetRepository(database.connection),
    new ManagedReferenceFiles(join(mediaDirectory, 'assets')), randomUUID, (id) => {
      if (assembly.references(id)) throw new Error('素材仍被排片工程或历史修订引用，不能删除')
      if (imageGeneration?.references(id)) throw new Error('素材仍被生图任务引用，不能删除或替换')
    })
  imageGeneration = new ImageGenerationService(new SqliteImageGenerationRepository(database.connection), {
    get: (id) => library.get(id),
    path: (id) => library.media(id).path,
    async assertProject(projectId) {
      if (projectId && !(await workspace.load()).projects.some((project) => project.id === projectId)) throw new Error('项目不存在或已删除')
    },
    register(node, file) {
      if (!node.accountSnapshot) throw new Error('缺少提交账号快照')
      return library.registerGeneratedImage({ ...file, id: node.id, projectId: node.projectId, title: node.title, prompt: node.prompt,
        accountId: node.accountSnapshot.id, accountName: node.accountSnapshot.name, accountGroup: node.accountSnapshot.accountGroup,
        baseUrl: node.accountSnapshot.baseUrl, model: node.accountSnapshot.model, submittedAt: node.submittedAt ?? node.createdAt }).id
    }
  }, new SafeStorageCredentialVault(), new ProtocolImageGateway([new OpenAiImageProtocol()], new LocalImageOutputStore(join(mediaDirectory, 'assets'))), randomUUID)
  const finalVideoFiles = new ManagedFinalVideoFiles(join(mediaDirectory, 'assets'), allowedMediaUrl)
  const mediaEngine = new LocalMediaEngine(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'media-engine', 'win32-x64'),
    new SqliteContinuityEngineRepository(database.connection))
  const continuityFiles = new FfmpegContinuityFiles(join(mediaDirectory, 'assets'), mediaEngine)
  const assemblyExport = new AssemblyExportService(assembly, { get: (id) => library.get(id), path: (id) => library.media(id).path })
  const references = new ReferenceService(new SqliteReferenceRepository(database.connection), library, randomUUID)
  const samplingFiles = new ManagedSamplingFiles(join(mediaDirectory, 'sampling'))
  generation = new GenerationService(new SqliteGenerationRepository(database.connection, samplingFiles), {
    routes() {
      return accounts.list().accounts.filter((account) => account.enabled).flatMap((account) => {
        const owned = workflows.list().filter((workflow) => workflow.accountId === account.id && workflow.enabled)
        const defaults = owned.filter((workflow) => workflow.isDefault)
        const selected = defaults.length === 1 ? defaults[0] : defaults.length === 0 && owned.length === 1 ? owned[0] : undefined
        return selected ? [{ configId: selected.id, accountId: account.id, workflowId: selected.workflowId }] : []
      })
    },
    async draft(projectId, draftId, expectedRevision) {
      const current = await workspace.load()
      if (current.revision !== expectedRevision) throw new Error('草稿版本已变化，请保存后重新提交')
      const draft = current.projects.find((project) => project.id === projectId)?.videoDrafts.find((item) => item.id === draftId)
      if (!draft) throw new Error('视频草稿不存在，请先保存')
      return draft
    },
    references(draftId, projectId) {
      return references.list(draftId).map((reference) => {
        const asset = library.get(reference.assetId)
        if (asset.archived || asset.projectId && asset.projectId !== projectId || asset.kind !== reference.kind) throw new Error('参考素材已归档或不属于当前项目')
        return { reference, path: library.media(reference.assetId).path }
      })
    },
    workflow(id) {
      const saved = workflows.get(id)
      if (!saved.accountId) throw new Error('工作流尚未分配账号')
      const workflow = workflows.forAccount(id, saved.accountId)
      return { accountId: saved.accountId, workflowId: workflow.workflowId }
    },
    credential: (id) => accounts.credential(id),
    async capacity(id) {
      const account = (await accounts.refresh(id)).accounts.find((item) => item.id === id)
      if (!account?.enabled || account.queueStatus !== 'ready' || !account.queue) throw new Error('无法确认原账号队列容量，未提交生成')
      return { limit: account.queue.concurrentLimit, occupied: account.queue.totalCurrentTasks }
    }
  }, new RunningHubGenerationGateway(), previews, emitPreview, {
    async prepareContinuity(input, signal, authorize) {
      const requireSource = async () => {
        signal.throwIfAborted()
        const current = await workspace.load()
        if (!current.projects.some((project) => project.id === input.projectId && project.videoDrafts.some((draft) => draft.id === input.draftId))) throw new Error('草稿已删除')
        const source = library.get(input.assetId)
        if (source.archived || source.kind !== 'video' || source.projectId !== input.projectId) throw new Error('衔接源素材不属于当前项目')
        signal.throwIfAborted()
      }
      await requireSource()
      authorize?.()
      const files = await continuityFiles.prepare(input.assetId, library.media(input.assetId).path, input.seconds, signal)
      await requireSource()
      authorize?.()
      const assets = library.registerContinuityAssets({ ...input, sourceAssetId: input.assetId, ...files })
      return { ...assets, start: files.start, end: files.end }
    },
    async save(input, signal) {
      const file = await finalVideoFiles.save(input.jobId, input.source, signal)
      signal.throwIfAborted()
      return library.registerGeneratedVideo({ ...file, projectId: input.projectId, title: input.title,
        prompt: input.prompt, jobId: input.jobId, submittedAt: input.submittedAt }).id
    }
  })
  const voices = new VoiceService(library)
  const mcp = new AssetMcpServer(library, undefined, async () => (await workspace.load()).projects.map(({ id, name }) => ({ id, name })),
    new WorkspaceDraftService(workspace, references), new SqliteMcpTokenStore(database.connection), personalLibrary, assembly, new FfmpegMediaInspector(mediaEngine), generation, imageGeneration, voices)
  const extensionDirectory = join(app.getPath('userData'), 'extensions')
  const extensions = new ExtensionService(new SqliteExtensionRepository(database.connection), new ManagedExtensionPackages(extensionDirectory),
    new UtilityExtensionHost(extensionHostEntry(app.isPackaged, process.resourcesPath, __dirname), extensionDirectory), new SafeStorageExtensionVault())
  const extensionPages = new ExtensionPageService(extensions, {
    async projectExists(id) { return (await workspace.load()).projects.some((project) => project.id === id) },
    asset(id) { return library.get(id) }
  })
  const production = new ProductionService(new SqliteProductionRepository(database.connection), extensions, {
    async scopes() {
      const current = await workspace.load()
      return current.projects.flatMap((project) => project.videoDrafts.map((draft) => ({ projectId: project.id, draftId: draft.id })))
    },
    async draft(scope) {
      const current = await workspace.load()
      const draft = current.projects.find((project) => project.id === scope.projectId)?.videoDrafts.find((item) => item.id === scope.draftId)
      if (!draft) throw new Error('视频草稿不存在，请先保存')
      return { prompt: draft.prompt }
    }
  }, new ManagedProductionAudio(join(mediaDirectory, 'production-staging')), {
    async importAudio(scope, path, name, notes) {
      const assets = await library.import({ projectId: scope.projectId, categoryId: null, kind: 'audio',
        tags: ['台词生成'], prompt: '', notes }, [path])
      const asset = assets[0]!
      library.update({ ...asset, name, expectedUpdatedAt: asset.updatedAt })
      return asset.id
    },
    ensureAudio(id) {
      const asset = library.get(id)
      if (asset.kind !== 'audio' || asset.archived) throw new Error('候选音频不存在或已归档')
    }
  }, randomUUID)
  const assemblyFontDirectory = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'fonts')
  registerAssetProtocol(library, samplingFiles, assemblyFontDirectory)
  const migration = new MigrationService(new EncryptedMigrationArchive(database.connection, app.getPath('userData'), mediaDirectory), (mode) => {
    const storage = mediaStorage.status()
    if (storage.pendingDirectory || storage.cleanupDirectory) throw new Error('素材位置正在迁移或清理，请完成后再迁移数据')
    if (library.hasPendingImports() || production.hasStorageActivity() || assemblyExport.hasActivity()) throw new Error('正在导入素材、处理音频或导出成片，请完成文件操作后再迁移数据')
    if (mode === 'import' && (generation?.hasStorageActivity() || imageGeneration?.hasPending() || imageGeneration?.hasActivity())) {
      throw new Error('仍有未结束任务，请处理后再导入；导出不受历史任务状态限制')
    }
    // 导出允许远端状态未确认的历史记录，但必须冻结会覆盖受管文件的后台工作。
    const resumeVideo = generation?.pauseForSnapshot()
    let resumeImage: (() => void) | undefined
    try { resumeImage = imageGeneration?.pauseForSnapshot(); mcp.stop() }
    catch (error) { resumeVideo?.(); throw error }
    return () => { try { resumeVideo?.() } finally { resumeImage?.() } }
  })
  const skills = new BuiltinSkillService(new LocalBuiltinSkillFiles(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'skills')))
  // 迁移过程中不能经窗口关闭或托盘退出中断数据库与文件的交接。
  let taskQuitConfirmed = false
  let taskQuitPromptPending = false
  const closePrompts = new WindowClosePrompts()
  const closingWindows = new WeakSet<BrowserWindow>()
  const confirmedWindows = new WeakSet<BrowserWindow>()
  const hasGenerationActivity = () => imageGeneration?.hasCloseActivity() ||
    generation?.hasCloseActivity() || production.hasStorageActivity()
  const confirmTaskClose = async (window: BrowserWindow | undefined, exiting: boolean): Promise<boolean> => {
    if (window && closePrompts.isReady(window.id) && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isLoading() && !window.webContents.isCrashed()) {
      if (window.isMinimized()) window.restore()
      window.show(); window.focus()
      return closePrompts.request(window, exiting)
    }
    // 加载中或渲染器不可用时保留系统确认，不能因为定制界面不可用而放行退出。
    const options = {
      type: 'warning' as const, title: '仍有生成任务未结束',
      message: exiting ? '仍有排队、生成、下载或状态待核对的任务，确定退出软件？' : '仍有生成任务未结束，确定关闭此窗口？',
      detail: exiting
        ? '退出会中断本地上传、下载和任务监听。关闭软件不等于取消远端任务，可能已计费；重启后需核对状态，不会自动重新提交生成。'
        : '其他窗口仍保持打开，后台任务会继续。关闭此窗口不等于取消远端任务。',
      buttons: ['继续等待', exiting ? '仍然退出' : '关闭此窗口'], defaultId: 0, cancelId: 0, noLink: true
    }
    return (window ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)) === 1
  }
  app.on('before-quit', (event) => {
    if (migration.isBusy()) { event.preventDefault(); return }
    if (taskQuitConfirmed || !hasGenerationActivity()) return
    event.preventDefault()
    if (taskQuitPromptPending) return
    taskQuitPromptPending = true
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
    void confirmTaskClose(window, true).then((confirmed) => {
      if (!confirmed || migration.isBusy()) return
      // 同一轮退出只确认一次；未保存保护阻止关闭后仍须重新确认。
      taskQuitConfirmed = true
      app.quit()
    }).catch(() => {}).finally(() => { taskQuitPromptPending = false })
  })
  app.on('browser-window-created', (_event, window) => {
    // UI 重新载入、崩溃或无响应后撤销旧确认；未重新握手前使用原生回退。
    const disconnectClosePrompt = () => closePrompts.disconnect(window.id)
    window.on('closed', disconnectClosePrompt)
    window.on('unresponsive', disconnectClosePrompt)
    window.webContents.on('did-start-loading', disconnectClosePrompt)
    window.webContents.on('render-process-gone', disconnectClosePrompt)
    window.webContents.on('will-prevent-unload', (event) => {
      // 等未保存对话框处理完：未放弃修改才撤销本轮退出确认。
      setImmediate(() => { if (!event.defaultPrevented) taskQuitConfirmed = false })
    })
    window.on('close', (event) => {
      if (migration.isBusy()) { event.preventDefault(); return }
      if (taskQuitConfirmed || confirmedWindows.delete(window) || !hasGenerationActivity()) return
      event.preventDefault()
      if (closingWindows.has(window)) return
      closingWindows.add(window)
      const exiting = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed()).length <= 1
      void confirmTaskClose(window, exiting).then((confirmed) => {
        if (!confirmed || window.isDestroyed() || migration.isBusy()) return
        const nowExiting = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed()).length <= 1
        if (nowExiting !== exiting) { closingWindows.delete(window); window.close(); return }
        if (exiting) taskQuitConfirmed = true
        else confirmedWindows.add(window)
        window.close()
      }).catch(() => {}).finally(() => { closingWindows.delete(window) })
    })
  })
  const assemblyWindows = new AssemblyWindows((onCreated) => createWindow({ assembly: true, onCreated }), () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('assembly:windows-changed')
    }
  })
  const workbenchWindows = new WorkbenchWindows((onCreated) => createWindow({ workbench: true, onCreated }), () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('workbench:windows-changed')
    }
  })
  registerWorkbench(workspace, previews, allowedMediaUrl, accounts, workflows, references, library, mcp, extensions, production, generation,
    (media) => samplingFiles.forDownload(media), (id) => diagnostics.read(id), { library: personalLibrary, settings, pages: extensionPages, assembly, assemblyExport,
      assemblyRenderer: (ffmpeg, ffprobe) => new FfmpegAssemblyRenderer(ffmpeg, ffprobe, assemblyFontDirectory),
      voices, mediaEngine, migration, skills, images: imageGeneration, assemblyWindows, workbenchWindows, closePrompts })
  imageGeneration.restore()
  generation.restore()
  try {
    await startRememberedMcp(settings.preferences(), settings.mcpPreferences(),
      async (id) => (await workspace.load()).projects.some((project) => project.id === id),
      (input, directory) => mcp.start(input, directory))
  } catch {
    // 启动失败不阻塞工作台，不换端口、不降低授权，状态页提供人工处理入口。
    mcp.reportStartupFailure()
  }
  app.once('will-quit', () => {
    imageGeneration?.stop()
    generation?.stop()
    previews.stopAll()
    mcp.stop()
    production.stop()
    extensions.stopAll()
    database.close()
  })
}
