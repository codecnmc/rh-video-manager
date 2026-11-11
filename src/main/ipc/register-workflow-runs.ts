import { dialog } from 'electron'
import { z } from 'zod'
import { startWorkflowRunSchema } from '../../shared/contracts/workflow-runs'
import { saveWorkflowApplicationSchema } from '../../shared/contracts/workflows'
import type { WorkflowRunService } from '../modules/workflows'
import type { WorkflowService } from '../modules/workflows'
import type { LibraryService } from '../modules/assets'
import type { DesktopHandle } from './handle'
import { referenceExtensions } from '../infrastructure/files/reference-files'

export function registerWorkflowRuns(handle: DesktopHandle, runs: WorkflowRunService, workflows: WorkflowService, library: LibraryService) {
  handle('workflows:save-application', async (input) => {
    const parsed = saveWorkflowApplicationSchema.parse(input)
    if (runs.hasPending(undefined, parsed.id)) throw new Error('请等待当前工作流任务结束后修改应用')
    return workflows.saveApplication(parsed)
  })
  handle('workflow-runs:list', async (input) => runs.list(z.object({ workflowId: z.string().uuid().optional() }).parse(input ?? {}).workflowId))
  handle('workflow-runs:start', async (input) => runs.start(startWorkflowRunSchema.parse(input)))
  handle('workflow-runs:refresh', async (input) => runs.refresh(z.object({ id: z.string().uuid() }).parse(input).id))
  handle('workflow-runs:remove-failed', async (input) => { const parsed = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string() }).parse(input); runs.removeFailed(parsed.id, parsed.expectedUpdatedAt) })
  handle('workflow-runs:choose-media', async (input, window) => {
    const parsed = z.object({ workflowId: z.string().uuid(), key: z.string().min(1).max(100) }).parse(input)
    const workflow = workflows.get(parsed.workflowId)
    const field = workflow.form?.fields.find((item) => item.key === parsed.key)
    if (!workflow.enabled || !field || field.type !== 'image' && field.type !== 'audio') throw new Error('媒体字段不存在，请重新检测')
    const selected = await dialog.showOpenDialog(window, { title: '选择工作流参考素材', properties: ['openFile'], filters: [{ name: '参考素材', extensions: field.type === 'audio' ? ['mp3', 'wav', 'flac'] : referenceExtensions.image }] })
    if (selected.canceled) return null
    return (await library.import({ projectId: null, categoryId: null, kind: field.type, tags: ['工作流参考'], prompt: '', notes: '' }, selected.filePaths))[0] ?? null
  })
}
