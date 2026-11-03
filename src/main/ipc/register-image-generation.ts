import { z } from 'zod'
import { createImageBoardSchema, createImageNodeSchema, saveImageAccountSchema, saveImageNodeSchema, saveImageLayoutSchema,
  submitImageNodesSchema, imageNodeActionSchema, reviewImageNodeSchema, imageExecutionSettingsSchema } from '../../shared/contracts/image-generation'
import type { ImageGenerationService } from '../modules/image-generation'
import type { DesktopHandle } from './handle'
import { deleteImageNodesSchema } from '../../shared/contracts/image-generation'

export function registerImageGeneration(handle: DesktopHandle, images: ImageGenerationService): void {
  const id = z.object({ id: z.string().uuid() })
  handle('images:accounts', async () => images.accounts())
  handle('images:settings', async () => images.settings())
  handle('images:save-settings', async (input) => images.saveSettings(imageExecutionSettingsSchema.parse(input)))
  handle('images:save-account', async (input) => images.saveAccount(saveImageAccountSchema.parse(input)))
  handle('images:resume-account', async (input) => images.resumeAccount(id.extend({ confirmed: z.literal(true) }).parse(input).id))
  handle('images:boards', async (input) => images.boards(z.object({ projectId: z.string().uuid().nullable() }).parse(input).projectId))
  handle('images:create-board', async (input) => images.createBoard(createImageBoardSchema.parse(input)))
  handle('images:nodes', async (input) => images.nodes(id.parse(input).id))
  handle('images:create-node', async (input) => images.createNode(createImageNodeSchema.parse(input)))
  handle('images:save-node', async (input) => images.saveNode(saveImageNodeSchema.parse(input)))
  handle('images:delete-nodes', async (input) => images.deleteNodes(deleteImageNodesSchema.parse(input)))
  handle('images:layout', async (input) => images.saveLayout(saveImageLayoutSchema.parse(input)))
  // 所有收费与恢复操作只注册专用桌面 IPC，不交给 MCP。
  handle('images:submit', async (input) => images.submit(submitImageNodesSchema.parse(input)))
  handle('images:cancel-queued', async (input) => images.cancelQueued(imageNodeActionSchema.parse(input)))
  handle('images:resolve-unknown', async (input) => images.resolveUnknown(imageNodeActionSchema.extend({ confirmed: z.literal(true) }).parse(input)))
  handle('images:retry-output', async (input) => {
    // 下载在主进程继续执行，桌面调用只等待启动，不占住页面操作锁。
    await images.startOutputRecovery(imageNodeActionSchema.parse(input))
  })
  handle('images:review', async (input) => images.review(reviewImageNodeSchema.parse(input)))
}
