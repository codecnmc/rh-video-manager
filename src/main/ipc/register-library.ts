import { clipboard, ClipboardItem, dialog, nativeImage } from 'electron'
import { z } from 'zod'
import { assetFilterSchema, importAssetsSchema, autoImportAssetsSchema, importAssetFilesSchema, saveCategorySchema, savePromptAssetSchema, updateAssetSchema, pasteAssetsSchema, moveAssetsSchema } from '../../shared/contracts/assets'
import { entityIdSchema } from '../../shared/contracts/accounts'
import { startAssetMcpSchema } from '../../shared/contracts/mcp'
import type { LibraryService } from '../modules/assets'
import type { WorkspaceService } from '../application/workspace-service'
import type { AssetMcpServer } from '../mcp/asset-server'
import { referenceExtensions } from '../infrastructure/files/reference-files'
import type { DesktopHandle } from './handle'
import type { SettingsService } from '../modules/settings'

export function registerLibrary(handle: DesktopHandle, library: LibraryService, workspace: WorkspaceService, mcp: AssetMcpServer, settings?: SettingsService): void {
  const project = async (id: string | null) => {
    if (id && !(await workspace.load()).projects.some((item) => item.id === id)) throw new Error('项目不存在')
  }
  handle('assets:list', async (input) => library.list(assetFilterSchema.parse(input)))
  handle('assets:categories', async (input) => library.categories(z.object({ projectId: z.string().uuid().nullable().optional() }).parse(input ?? {}).projectId))
  handle('assets:move', async (input) => library.move(moveAssetsSchema.parse(input)))
  handle('assets:paste', async (input) => {
    const parsed = pasteAssetsSchema.parse(input)
    await project(parsed.projectId)
    return library.paste(parsed)
  })
  handle('assets:category-save', async (input) => {
    const parsed = saveCategorySchema.parse(input)
    if (parsed.projectId !== undefined) await project(parsed.projectId)
    return library.saveCategory(parsed)
  })
  handle('assets:category-delete', async (input) => library.removeCategory(entityIdSchema.parse(input).id))
  handle('assets:category-move', async (input) => {
    const parsed = entityIdSchema.extend({ parentId: z.string().uuid().nullable() }).parse(input)
    return library.moveCategory(parsed.id, parsed.parentId)
  })
  handle('assets:import', async (input, window) => {
    const parsed = z.union([importAssetsSchema, autoImportAssetsSchema]).parse(input)
    await project(parsed.projectId)
    const selection = await dialog.showOpenDialog(window, { title: '导入素材', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '素材', extensions: parsed.kind === 'auto' ? Object.values(referenceExtensions).flat() : referenceExtensions[parsed.kind] }] })
    if (selection.canceled) return []
    return parsed.kind === 'auto' ? library.importAuto(parsed, selection.filePaths) : library.import(parsed, selection.filePaths)
  })
  handle('assets:import-files', async (input) => {
    const parsed = importAssetFilesSchema.extend({ paths: z.array(z.string().min(1).max(32767)).min(1).max(20) }).parse(input)
    await project(parsed.projectId)
    return library.importAuto({ projectId: parsed.projectId, categoryId: parsed.categoryId, kind: 'auto', tags: [], prompt: '', notes: '' }, parsed.paths)
  })
  handle('assets:prompt-save', async (input) => {
    const parsed = savePromptAssetSchema.parse(input)
    await project(parsed.projectId)
    return library.savePrompt(parsed)
  })
  handle('assets:update', async (input) => library.update(updateAssetSchema.parse(input)))
  handle('assets:delete', async (input) => library.remove(entityIdSchema.parse(input).id))
  handle('assets:archive', async (input) => {
    const parsed = entityIdSchema.extend({ archived: z.boolean() }).parse(input)
    library.archive(parsed.id, parsed.archived)
  })
  handle('assets:reveal', async (input) => library.reveal(entityIdSchema.parse(input).id))
  handle('assets:copy-prompt', async (input) => { clipboard.writeText(library.get(entityIdSchema.parse(input).id).prompt) })
  handle('assets:copy-id', async (input) => {
    const asset = library.get(entityIdSchema.parse(input).id)
    await project(asset.projectId)
    await clipboard.writeText(library.get(asset.id).id)
  })
  handle('assets:copy-image', async (input) => {
    const { id } = entityIdSchema.parse(input)
    const asset = library.get(id)
    const original = await library.readImage(id, asset.updatedAt, (current) => project(current.projectId))
    const image = nativeImage.createFromBuffer(Buffer.from(original.bytes))
    if (image.isEmpty()) throw new Error('图片解码失败，未修改剪贴板')
    // Electron 44 使用异步 ClipboardItem；转成 PNG 保留像素尺寸和透明度。
    const png = new Uint8Array(image.toPNG())
    if (!png.byteLength) throw new Error('图片编码失败，未修改剪贴板')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
  })
  handle('mcp:status', async () => mcp.status())
  const configuredSettings = () => {
    if (!settings) throw new Error('MCP 设置存储尚未配置')
    return settings
  }
  const preferences = () => configuredSettings().mcpPreferences()
  handle('mcp:preferences', async () => preferences())
  handle('mcp:choose-directory', async (_input, window) => {
    const current = preferences()
    const selected = await dialog.showOpenDialog(window, { title: '选择 MCP 素材导入目录',
      ...(current.importDirectory ? { defaultPath: current.importDirectory } : {}), properties: ['openDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return current
    // 只记住选择，不在此处开启服务或改变已开放会话的权限。
    return configuredSettings().saveMcpPreferences({ ...current, importDirectory: selected.filePaths[0] })
  })
  handle('mcp:start', async (input, window) => {
    const parsed = startAssetMcpSchema.parse(input)
    await project(parsed.projectId)
    const remembered = preferences()
    let directory = remembered.importDirectory
    if (parsed.writeEnabled && !directory) {
      const selected = await dialog.showOpenDialog(window, { title: '授权 MCP 导入的本地素材目录', properties: ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) throw new Error('未授权导入目录，MCP 未开启')
      directory = selected.filePaths[0]
    }
    const state = await mcp.start(parsed, directory)
    try {
      await project(parsed.projectId)
      // 自定义令牌只交给加密凭据存储，不进入偏好设置或前端查询缓存。
      configuredSettings().saveMcpPreferences({ projectId: parsed.projectId, allProjects: parsed.allProjects,
        writeEnabled: parsed.writeEnabled, minutes: parsed.minutes, importDirectory: parsed.writeEnabled ? state.importDirectory : directory,
        publicVoicesEnabled: parsed.publicVoicesEnabled, scriptLibraryEnabled: parsed.scriptLibraryEnabled, assemblyEnabled: parsed.assemblyEnabled, imageGenerationEnabled: parsed.imageGenerationEnabled, imageSubmissionEnabled: parsed.imageSubmissionEnabled })
    }
    catch (error) { mcp.stop(); throw error }
    return state
  })
  handle('mcp:stop', async () => { mcp.stop(); return mcp.status() })
  handle('mcp:copy-config', async () => { clipboard.writeText(mcp.configuration()) })
}
