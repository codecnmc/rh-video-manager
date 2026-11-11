import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi } from '../shared/contracts/desktop'
import type { PreviewEvent } from '../shared/contracts/preview'
import { previewNotificationTargetSchema } from '../shared/contracts/preview'
import { assemblyExportProgressSchema } from '../shared/contracts/assembly-export'
import { windowClosePromptSchema } from '../shared/contracts/window-close'

const api: DesktopApi = {
  listWorkflowRuns: (workflowId) => ipcRenderer.invoke('workflow-runs:list', { workflowId }),
  startWorkflowRun: (input) => ipcRenderer.invoke('workflow-runs:start', input),
  refreshWorkflowRun: (id) => ipcRenderer.invoke('workflow-runs:refresh', { id }),
  removeFailedWorkflowRun: (id, expectedUpdatedAt) => ipcRenderer.invoke('workflow-runs:remove-failed', { id, expectedUpdatedAt }),
  chooseWorkflowMedia: (workflowId, key) => ipcRenderer.invoke('workflow-runs:choose-media', { workflowId, key }),
  listPublicVoices: () => ipcRenderer.invoke('voices:list'),
  renamePublicVoice: (input) => ipcRenderer.invoke('voices:rename', input),
  importPublicVoices: () => ipcRenderer.invoke('voices:import'),
  createPublicVoice: (input) => ipcRenderer.invoke('voices:from-asset', input),
  currentWindowClosePrompt: () => ipcRenderer.invoke('window:close-prompt-current'),
  respondWindowClosePrompt: (input) => ipcRenderer.invoke('window:close-prompt-respond', input),
  onWindowClosePrompt: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = windowClosePromptSchema.nullable().safeParse(input)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('window:close-prompt', handler)
    return () => ipcRenderer.removeListener('window:close-prompt', handler)
  },
  checkReleaseUpdate: () => ipcRenderer.invoke('updates:check'),
  openReleaseDownloads: () => ipcRenderer.invoke('updates:open-releases'),
  workbenchWindowContext: () => ipcRenderer.invoke('workbench:window-context'),
  openWorkbenchWindow: (input) => ipcRenderer.invoke('workbench:open-window', input),
  rememberWorkbenchProject: (projectId) => ipcRenderer.invoke('workbench:remember-project', { projectId }),
  workbenchWindowState: () => ipcRenderer.invoke('workbench:window-state'),
  reportWorkbenchPresence: (input) => ipcRenderer.invoke('workbench:report-presence', input),
  onWorkbenchWindowsChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('workbench:windows-changed', handler)
    return () => ipcRenderer.removeListener('workbench:windows-changed', handler)
  },
  deleteImageNodes: (input) => ipcRenderer.invoke('images:delete-nodes', input),
  imageAccounts: () => ipcRenderer.invoke('images:accounts'),
  imageExecutionSettings: () => ipcRenderer.invoke('images:settings'),
  saveImageExecutionSettings: (input) => ipcRenderer.invoke('images:save-settings', input),
  saveImageAccount: (input) => ipcRenderer.invoke('images:save-account', input),
  resumeImageAccount: (id, confirmed) => ipcRenderer.invoke('images:resume-account', { id, confirmed }),
  imageBoards: (projectId) => ipcRenderer.invoke('images:boards', { projectId }),
  createImageBoard: (input) => ipcRenderer.invoke('images:create-board', input),
  imageNodes: (id) => ipcRenderer.invoke('images:nodes', { id }),
  createImageNode: (input) => ipcRenderer.invoke('images:create-node', input),
  saveImageNode: (input) => ipcRenderer.invoke('images:save-node', input),
  saveImageLayout: (input) => ipcRenderer.invoke('images:layout', input),
  submitImageNodes: (input) => ipcRenderer.invoke('images:submit', input),
  cancelQueuedImage: (input) => ipcRenderer.invoke('images:cancel-queued', input),
  resolveUnknownImage: (input) => ipcRenderer.invoke('images:resolve-unknown', input),
  retryImageOutput: (input) => ipcRenderer.invoke('images:retry-output', input),
  reviewImageNode: (input) => ipcRenderer.invoke('images:review', input),
  exportWorkspaceMigration: (password) => ipcRenderer.invoke('migration:export', { password }),
  importWorkspaceMigration: (password) => ipcRenderer.invoke('migration:import', { password }),
  installBuiltinSkill: (id) => ipcRenderer.invoke('skills:install', id),
  exportBuiltinSkill: (id) => ipcRenderer.invoke('skills:export', id),
  confirmGenerationCancellation: (id, expectedTaskId, confirmed) => ipcRenderer.invoke('generation:confirm-cancellation', { id, expectedTaskId, confirmed }),
  listAssemblies: (projectId) => ipcRenderer.invoke('assembly:list', { projectId }),
  assemblyWindowState: () => ipcRenderer.invoke('assembly:window-state'),
  openAssemblyWindow: (input) => ipcRenderer.invoke('assembly:open-window', input),
  assemblySelection: (projectId) => ipcRenderer.invoke('assembly:selection', { projectId }),
  selectAssembly: (input) => ipcRenderer.invoke('assembly:select', input),
  onAssemblyWindowsChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('assembly:windows-changed', handler)
    return () => ipcRenderer.removeListener('assembly:windows-changed', handler)
  },
  saveAssembly: (input) => ipcRenderer.invoke('assembly:save', input),
  exportAssembly: (input) => ipcRenderer.invoke('assembly:export', input),
  cancelAssemblyExport: (requestId) => ipcRenderer.invoke('assembly:cancel-export', { requestId }),
  onAssemblyExportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = assemblyExportProgressSchema.safeParse(input)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('assembly:export-progress', handler)
    return () => ipcRenderer.removeListener('assembly:export-progress', handler)
  },
  listLibraryDocuments: (projectId) => ipcRenderer.invoke('script-library:list', { projectId }),
  assignLibraryDocument: (input) => ipcRenderer.invoke('script-library:assign', input),
  saveLibraryDocument: (input) => ipcRenderer.invoke('script-library:save', input),
  deleteLibraryDocument: (input) => ipcRenderer.invoke('script-library:delete', input),
  exportLibraryBackup: () => ipcRenderer.invoke('script-library:backup'),
  importLibraryBackup: () => ipcRenderer.invoke('script-library:restore'),
  appPreferences: () => ipcRenderer.invoke('settings:preferences'),
  saveAppPreferences: (input) => ipcRenderer.invoke('settings:save-preferences', input),
  appInformation: () => ipcRenderer.invoke('settings:information'),
  openSettingsDirectory: (directory) => ipcRenderer.invoke('settings:open-directory', directory),
  chooseMediaStorageDirectory: () => ipcRenderer.invoke('settings:choose-media-directory'),
  cancelMediaStorageChange: () => ipcRenderer.invoke('settings:cancel-media-change'),
  restartForMediaStorage: () => ipcRenderer.invoke('settings:restart-for-media'),
  copyVideoDraft: (input) => ipcRenderer.invoke('workspace:copy-video', input),
  submitGeneration: (input) => ipcRenderer.invoke('generation:submit', input),
  scheduleGeneration: (input) => ipcRenderer.invoke('generation:schedule', input),
  refreshGenerationResults: (id, workflowUnchangedConfirmed) => ipcRenderer.invoke('generation:refresh-results', { id, workflowUnchangedConfirmed }),
  consumptionLedger: (filter) => ipcRenderer.invoke('generation:consumption-ledger', filter),
  refreshTaskConsumption: (id) => ipcRenderer.invoke('generation:refresh-consumption', { id }),
  taskOutputAction: (id, index, action) => ipcRenderer.invoke('preview:output-action', { id, index, action }),
  exportTaskDiagnostics: (id) => ipcRenderer.invoke('preview:export-diagnostics', { id }),
  retryFinalArchive: (id) => ipcRenderer.invoke('generation:retry-final-archive', { id }),
  releaseGenerationReservation: (id, expectedTaskId, confirmed) => ipcRenderer.invoke('generation:release-reservation', { id, expectedTaskId, confirmed }),
  productionCapabilities: () => ipcRenderer.invoke('production:capabilities'),
  listDialogueTasks: () => ipcRenderer.invoke('production:tasks'),
  loadProduction: (input) => ipcRenderer.invoke('production:load', input),
  saveProduction: (input) => ipcRenderer.invoke('production:save', input),
  saveCharacterVoice: (input) => ipcRenderer.invoke('production:voice-binding', input),
  generateDialogue: (input) => ipcRenderer.invoke('production:generate', input),
  cancelDialogue: (input) => ipcRenderer.invoke('production:cancel', input),
  adoptDialogue: (input) => ipcRenderer.invoke('production:adopt', input),
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  runExtensionPage: (input) => ipcRenderer.invoke('extensions:page', input),
  installExtension: () => ipcRenderer.invoke('extensions:install'),
  setExtensionEnabled: (id, enabled) => ipcRenderer.invoke('extensions:enabled', { id, enabled }),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', { id }),
  saveExtensionSettings: (input) => ipcRenderer.invoke('extensions:settings', input),
  saveExtensionSecret: (input) => ipcRenderer.invoke('extensions:secret', input),
  runExtensionCommand: (id, command) => ipcRenderer.invoke('extensions:command', { id, command }),
  runExtensionContextCommand: (input) => ipcRenderer.invoke('extensions:context-command', input),
  listExtensionVoices: (id, providerId) => ipcRenderer.invoke('extensions:voices', { id, providerId }),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  saveAccount: (input) => ipcRenderer.invoke('accounts:save', input),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', { id }),
  refreshAccounts: (id) => ipcRenderer.invoke('accounts:refresh', { id }),
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  exportWorkflowTemplate: (template = 'accelerated') => ipcRenderer.invoke('workflows:export-template', { template }),
  saveWorkflow: (input) => ipcRenderer.invoke('workflows:save', input),
  deleteWorkflow: (id) => ipcRenderer.invoke('workflows:delete', { id }),
  saveWorkflowApplication: (input) => ipcRenderer.invoke('workflows:save-application', input),
  inspectWorkflow: (id) => ipcRenderer.invoke('workflows:inspect', { id }),
  listAssets: (input) => ipcRenderer.invoke('assets:list', input),
  listAssetCategories: (projectId) => ipcRenderer.invoke('assets:categories', { projectId }),
  saveAssetCategory: (input) => ipcRenderer.invoke('assets:category-save', input),
  deleteAssetCategory: (id) => ipcRenderer.invoke('assets:category-delete', { id }),
  moveAssetCategory: (id, parentId) => ipcRenderer.invoke('assets:category-move', { id, parentId }),
  importAssets: (input) => ipcRenderer.invoke('assets:import', input),
  importAssetFiles: async (input, files) => {
    if (!Array.isArray(files) || !files.length || files.length > 20) return { ok: false, error: '每次导入 1–20 个文件' }
    try {
      // 只在 preload 从真实 File 提取来源路径，不向页面暴露任意路径导入或文件系统接口。
      const paths = files.map((file: unknown) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]))
      if (paths.every((path) => !path)) return { ok: true, value: null }
      if (paths.some((path) => !path)) return { ok: false, error: '请将本地文件和剪贴板截图分开导入' }
      return ipcRenderer.invoke('assets:import-files', { projectId: input.projectId, categoryId: input.categoryId, paths })
    } catch { return { ok: false, error: '无法读取本地文件，请使用导入按钮选择文件' } }
  },
  pasteAssets: (input) => ipcRenderer.invoke('assets:paste', input),
  moveAssets: (input) => ipcRenderer.invoke('assets:move', input),
  savePromptAsset: (input) => ipcRenderer.invoke('assets:prompt-save', input),
  updateAsset: (input) => ipcRenderer.invoke('assets:update', input),
  archiveAsset: (id, archived) => ipcRenderer.invoke('assets:archive', { id, archived }),
  deleteAsset: (id) => ipcRenderer.invoke('assets:delete', { id }),
  revealAsset: (id) => ipcRenderer.invoke('assets:reveal', { id }),
  copyAssetPrompt: (id) => ipcRenderer.invoke('assets:copy-prompt', { id }),
  copyAssetImage: (id) => ipcRenderer.invoke('assets:copy-image', { id }),
  copyAssetId: (id) => ipcRenderer.invoke('assets:copy-id', { id }),
  assetMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  assetMcpPreferences: () => ipcRenderer.invoke('mcp:preferences'),
  chooseAssetMcpDirectory: () => ipcRenderer.invoke('mcp:choose-directory'),
  startAssetMcp: (input) => ipcRenderer.invoke('mcp:start', input),
  stopAssetMcp: () => ipcRenderer.invoke('mcp:stop'),
  copyAssetMcpConfig: () => ipcRenderer.invoke('mcp:copy-config'),
  listReferences: (draftId) => ipcRenderer.invoke('references:list', { draftId }),
  importReferences: (draftId, kind) => ipcRenderer.invoke('references:import', { draftId, kind }),
  pasteReferenceImages: (draftId, images) => ipcRenderer.invoke('references:paste-images', { draftId, images }),
  attachReference: (draftId, assetId) => ipcRenderer.invoke('references:attach', { draftId, assetId }),
  replaceDraftReference: (input) => ipcRenderer.invoke('references:replace', input),
  removeReference: (id) => ipcRenderer.invoke('references:remove', { id }),
  revealReference: (id) => ipcRenderer.invoke('references:reveal', { id }),
  windowAction: (action) => ipcRenderer.invoke('window:action', { action }),
  windowMaximized: () => ipcRenderer.invoke('window:maximized'),
  onWindowState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  },
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (input) => ipcRenderer.invoke('workspace:save', input),
  deleteWorkspaceEntity: (input) => ipcRenderer.invoke('workspace:delete', input),
  listPreviews: () => ipcRenderer.invoke('preview:list'),
  disconnectPreview: (id) => ipcRenderer.invoke('preview:disconnect', { id }),
  cancelTask: (id) => ipcRenderer.invoke('preview:cancel', { id }),
  downloadPreview: (id, kind) => ipcRenderer.invoke('preview:download', { id, kind }),
  copyPreviewUrl: (id, kind) => ipcRenderer.invoke('preview:copy-url', { id, kind }),
  onPreviewNotification: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const target = previewNotificationTargetSchema.safeParse(input)
      if (target.success) listener(target.data)
    }
    ipcRenderer.on('preview:open', handler)
    return () => ipcRenderer.removeListener('preview:open', handler)
  },
  onPreview: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: PreviewEvent) => listener(update)
    ipcRenderer.on('preview:event', handler)
    return () => { ipcRenderer.removeListener('preview:event', handler) }
  }
}

contextBridge.exposeInMainWorld('workbench', api)
