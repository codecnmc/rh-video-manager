import type { StartWorkflowRun, WorkflowRun } from './workflow-runs'
import type { CreateVoice, PublicVoice } from './voices'
import type { PreviewEvent, PreviewKind, PreviewSnapshot, PreviewNotificationTarget } from './preview'
import type { ScheduleGeneration, SubmitGeneration } from './generation'
import type { ConsumptionFilter, ConsumptionLedger } from './consumption'
import type { CopyVideoDraft, DeleteWorkspaceEntity, SaveWorkspace, Workspace } from './workspace'
import type { AccountPool, SaveAccount } from './accounts'
import type { SaveWorkflow, SaveWorkflowApplication, Workflow } from './workflows'
import type { ReferenceKind, DraftReference, PastedImage, ReplaceDraftReference } from './references'
import type { Asset, AssetCategory, AssetFilter, ImportAssets, AutoImportAssets, SavePromptAsset, SaveCategory, UpdateAsset, PasteAssets, MoveAssets } from './assets'
import type { AssetMcpStatus, AssetMcpPreferences, StartAssetMcp } from './mcp'
import type { InstalledExtension, SaveExtensionSettings, SaveExtensionSecret, SpeechVoice, SpeechCapability, ExtensionContextCommand, ExtensionProposal, ExtensionPageRequest } from './extensions'
import type { ProductionScope, DialogueProduction, DialoguePlan, DialogueTake, GenerateDialogue, ProductionTakeAction, AdoptDialogue, SaveCharacterVoice, ProjectVoices } from './production'
import type { LibraryDocument, SaveLibraryDocument, DeleteLibraryDocument, AssignLibraryDocument } from './script-library'
import type { AppPreferences, AppInformation, SettingsDirectory, MediaStorageStatus } from './settings'
import type { AssemblyDocument, SaveAssembly, ExportAssembly, AssemblyWindowState, AssemblyWindowTarget } from './assembly'
import type { AssemblyExportProgress } from './assembly-export'
import type { ImageAccount, SaveImageAccount, ImageBoard, CreateImageBoard, ImageNode, CreateImageNode, SaveImageNode,
  SubmitImageNodes, SaveImageLayout, ImageNodeAction, ReviewImageNode, ImageExecutionSettings } from './image-generation'

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface DesktopApi {
  previewDialog(kind: import('./window-close').DialogPreview): Promise<Result<boolean>>
  copyVoiceReferenceText(): Promise<Result<void>>
  listWorkflowRuns(workflowId?: string): Promise<Result<WorkflowRun[]>>
  startWorkflowRun(input: StartWorkflowRun): Promise<Result<WorkflowRun>>
  refreshWorkflowRun(id: string): Promise<Result<WorkflowRun>>
  removeFailedWorkflowRun(id: string, expectedUpdatedAt: string): Promise<Result<void>>
  chooseWorkflowMedia(workflowId: string, key: string): Promise<Result<Asset | null>>
  listPublicVoices(): Promise<Result<PublicVoice[]>>
  renamePublicVoice(input: import('./voices').RenameVoice): Promise<Result<PublicVoice>>
  deletePublicVoice(input: import('./voices').DeleteVoice): Promise<Result<void>>
  importPublicVoices(): Promise<Result<PublicVoice[]>>
  createPublicVoice(input: CreateVoice): Promise<Result<PublicVoice>>
  currentWindowClosePrompt(): Promise<Result<import('./window-close').WindowClosePrompt | null>>
  respondWindowClosePrompt(input: import('./window-close').WindowCloseDecision): Promise<Result<void>>
  onWindowClosePrompt(listener: (prompt: import('./window-close').WindowClosePrompt | null) => void): () => void
  checkReleaseUpdate(): Promise<Result<import('./updates').ReleaseUpdate>>
  openReleaseDownloads(): Promise<Result<void>>
  workbenchWindowContext(): Promise<Result<import('./workbench-windows').WorkbenchWindowContext>>
  openWorkbenchWindow(input: import('./workbench-windows').WorkbenchWindowTarget): Promise<Result<void>>
  rememberWorkbenchProject(projectId: string | null): Promise<Result<void>>
  workbenchWindowState(): Promise<Result<import('./workbench-windows').WorkbenchWindowState>>
  reportWorkbenchPresence(input: import('./workbench-windows').WorkbenchPresence): Promise<Result<void>>
  onWorkbenchWindowsChanged(listener: () => void): () => void
  deleteImageNodes(input: import('./image-generation').DeleteImageNodes): Promise<Result<{ ids: string[] }>>
  imageAccounts(): Promise<Result<ImageAccount[]>>
  imageExecutionSettings(): Promise<Result<ImageExecutionSettings>>
  saveImageExecutionSettings(input: ImageExecutionSettings): Promise<Result<ImageExecutionSettings>>
  saveImageAccount(input: SaveImageAccount): Promise<Result<ImageAccount[]>>
  resumeImageAccount(id: string, confirmed: true): Promise<Result<ImageAccount[]>>
  imageBoards(projectId: string | null): Promise<Result<ImageBoard[]>>
  createImageBoard(input: CreateImageBoard): Promise<Result<ImageBoard>>
  imageNodes(boardId: string): Promise<Result<ImageNode[]>>
  createImageNode(input: CreateImageNode): Promise<Result<ImageNode>>
  saveImageNode(input: SaveImageNode): Promise<Result<ImageNode>>
  saveImageLayout(input: SaveImageLayout): Promise<Result<ImageBoard>>
  submitImageNodes(input: SubmitImageNodes): Promise<Result<ImageNode[]>>
  cancelQueuedImage(input: ImageNodeAction): Promise<Result<ImageNode>>
  resolveUnknownImage(input: ImageNodeAction & { confirmed: true }): Promise<Result<ImageNode>>
  retryImageOutput(input: ImageNodeAction): Promise<Result<void>>
  reviewImageNode(input: ReviewImageNode): Promise<Result<ImageNode>>
  exportWorkspaceMigration(password: string): Promise<Result<boolean>>
  importWorkspaceMigration(password: string): Promise<Result<boolean>>
  installBuiltinSkill(id?: import('./skills').BuiltinSkillId): Promise<Result<string | null>>
  exportBuiltinSkill(id?: import('./skills').BuiltinSkillId): Promise<Result<boolean>>
  confirmGenerationCancellation(id: string, expectedTaskId: string, confirmed: true): Promise<Result<PreviewSnapshot>>
  listAssemblies(projectId: string | null): Promise<Result<AssemblyDocument[]>>
  assemblyWindowState(): Promise<Result<AssemblyWindowState>>
  openAssemblyWindow(input: AssemblyWindowTarget): Promise<Result<void>>
  assemblySelection(projectId: string | null): Promise<Result<string | null>>
  selectAssembly(input: { projectId: string | null; id: string | null }): Promise<Result<void>>
  onAssemblyWindowsChanged(listener: () => void): () => void
  saveAssembly(input: SaveAssembly): Promise<Result<AssemblyDocument>>
  exportAssembly(input: ExportAssembly): Promise<Result<boolean>>
  cancelAssemblyExport(requestId: string): Promise<Result<void>>
  revealAssemblyExport(requestId: string): Promise<Result<void>>
  onAssemblyExportProgress(listener: (progress: AssemblyExportProgress) => void): () => void
  listLibraryDocuments(projectId?: string | null): Promise<Result<LibraryDocument[]>>
  assignLibraryDocument(input: AssignLibraryDocument): Promise<Result<LibraryDocument>>
  saveLibraryDocument(input: SaveLibraryDocument): Promise<Result<LibraryDocument>>
  deleteLibraryDocument(input: DeleteLibraryDocument): Promise<Result<void>>
  exportLibraryBackup(): Promise<Result<boolean>>
  importLibraryBackup(): Promise<Result<number | null>>
  appPreferences(): Promise<Result<AppPreferences>>
  saveAppPreferences(input: Partial<AppPreferences>): Promise<Result<AppPreferences>>
  appInformation(): Promise<Result<AppInformation>>
  openSettingsDirectory(directory: SettingsDirectory): Promise<Result<void>>
  chooseMediaStorageDirectory(): Promise<Result<MediaStorageStatus | null>>
  cancelMediaStorageChange(): Promise<Result<MediaStorageStatus>>
  restartForMediaStorage(): Promise<Result<void>>
  copyVideoDraft(input: CopyVideoDraft): Promise<Result<{ workspace: Workspace; draftId: string }>>
  submitGeneration(input: SubmitGeneration): Promise<Result<PreviewSnapshot>>
  scheduleGeneration(input: ScheduleGeneration): Promise<Result<PreviewSnapshot>>
  refreshGenerationResults(id: string, workflowUnchangedConfirmed: boolean): Promise<Result<PreviewSnapshot>>
  consumptionLedger(filter: ConsumptionFilter): Promise<Result<ConsumptionLedger>>
  refreshTaskConsumption(id: string): Promise<Result<void>>
  taskOutputAction(id: string, index: number, action: 'copy' | 'download'): Promise<Result<boolean>>
  exportTaskDiagnostics(id: string): Promise<Result<boolean>>
  retryFinalArchive(id: string): Promise<Result<void>>
  releaseGenerationReservation(id: string, expectedTaskId: string, confirmed: true): Promise<Result<PreviewSnapshot>>
  productionCapabilities(): Promise<Result<SpeechCapability[]>>
  listDialogueTasks(): Promise<Result<DialogueTake[]>>
  loadProduction(input: ProductionScope): Promise<Result<DialogueProduction>>
  saveProduction(input: DialoguePlan): Promise<Result<DialoguePlan>>
  saveCharacterVoice(input: SaveCharacterVoice): Promise<Result<ProjectVoices>>
  generateDialogue(input: GenerateDialogue): Promise<Result<DialogueTake>>
  cancelDialogue(input: ProductionTakeAction): Promise<Result<void>>
  adoptDialogue(input: AdoptDialogue): Promise<Result<void>>
  listExtensions(): Promise<Result<InstalledExtension[]>>
  runExtensionPage(input: ExtensionPageRequest): Promise<Result<ExtensionProposal>>
  installExtension(): Promise<Result<InstalledExtension[]>>
  setExtensionEnabled(id: string, enabled: boolean): Promise<Result<InstalledExtension[]>>
  removeExtension(id: string): Promise<Result<InstalledExtension[]>>
  saveExtensionSettings(input: SaveExtensionSettings): Promise<Result<InstalledExtension[]>>
  saveExtensionSecret(input: SaveExtensionSecret): Promise<Result<InstalledExtension[]>>
  runExtensionCommand(id: string, command: string): Promise<Result<boolean>>
  runExtensionContextCommand(input: ExtensionContextCommand): Promise<Result<ExtensionProposal>>
  listExtensionVoices(id: string, providerId: string): Promise<Result<SpeechVoice[]>>
  listAccounts(): Promise<Result<AccountPool>>
  saveAccount(input: SaveAccount): Promise<Result<AccountPool>>
  deleteAccount(id: string): Promise<Result<AccountPool>>
  refreshAccounts(id: string | null): Promise<Result<AccountPool>>
  listWorkflows(): Promise<Result<Workflow[]>>
  exportWorkflowTemplate(template?: import('./workflows').WorkflowTemplate): Promise<Result<boolean>>
  saveWorkflow(input: SaveWorkflow): Promise<Result<Workflow[]>>
  deleteWorkflow(id: string): Promise<Result<Workflow[]>>
  saveWorkflowApplication(input: SaveWorkflowApplication): Promise<Result<Workflow[]>>
  inspectWorkflow(id: string): Promise<Result<Workflow[]>>
  listAssets(input: AssetFilter): Promise<Result<Asset[]>>
  listAssetCategories(projectId?: string | null): Promise<Result<AssetCategory[]>>
  saveAssetCategory(input: SaveCategory): Promise<Result<AssetCategory[]>>
  deleteAssetCategory(id: string): Promise<Result<AssetCategory[]>>
  moveAssetCategory(id: string, parentId: string | null): Promise<Result<AssetCategory[]>>
  importAssets(input: ImportAssets | AutoImportAssets): Promise<Result<Asset[]>>
  importAssetFiles(input: { projectId: string | null; categoryId: string | null }, files: readonly unknown[]): Promise<Result<Asset[] | null>>
  pasteAssets(input: PasteAssets): Promise<Result<Asset[]>>
  moveAssets(input: MoveAssets): Promise<Result<Asset[]>>
  savePromptAsset(input: SavePromptAsset): Promise<Result<Asset>>
  updateAsset(input: UpdateAsset): Promise<Result<Asset>>
  archiveAsset(id: string, archived: boolean): Promise<Result<void>>
  deleteAsset(id: string): Promise<Result<void>>
  revealAsset(id: string): Promise<Result<void>>
  copyAssetPrompt(id: string): Promise<Result<void>>
  copyAssetImage(id: string): Promise<Result<void>>
  copyAssetId(id: string): Promise<Result<void>>
  assetMcpStatus(): Promise<Result<AssetMcpStatus>>
  assetMcpPreferences(): Promise<Result<AssetMcpPreferences>>
  chooseAssetMcpDirectory(): Promise<Result<AssetMcpPreferences>>
  startAssetMcp(input: StartAssetMcp): Promise<Result<AssetMcpStatus>>
  stopAssetMcp(): Promise<Result<AssetMcpStatus>>
  copyAssetMcpConfig(): Promise<Result<void>>
  listReferences(draftId: string): Promise<Result<DraftReference[]>>
  importReferences(draftId: string, kind: ReferenceKind): Promise<Result<DraftReference[]>>
  pasteReferenceImages(draftId: string, images: PastedImage[]): Promise<Result<DraftReference[]>>
  attachReference(draftId: string, assetId: string): Promise<Result<DraftReference[]>>
  replaceDraftReference(input: ReplaceDraftReference): Promise<Result<DraftReference[]>>
  removeReference(id: string): Promise<Result<void>>
  revealReference(id: string): Promise<Result<void>>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<Result<boolean>>
  windowMaximized(): Promise<Result<boolean>>
  onWindowState(listener: (maximized: boolean) => void): () => void
  loadWorkspace(): Promise<Result<Workspace>>
  saveWorkspace(input: SaveWorkspace): Promise<Result<Workspace>>
  deleteWorkspaceEntity(input: DeleteWorkspaceEntity): Promise<Result<Workspace>>
  listPreviews(): Promise<Result<PreviewSnapshot[]>>
  disconnectPreview(id: string): Promise<Result<void>>
  cancelTask(id: string): Promise<Result<void>>
  downloadPreview(id: string, kind: PreviewKind): Promise<Result<boolean>>
  copyPreviewUrl(id: string, kind: PreviewKind): Promise<Result<void>>
  onPreview(listener: (event: PreviewEvent) => void): () => void
  onPreviewNotification(listener: (target: PreviewNotificationTarget) => void): () => void
}
