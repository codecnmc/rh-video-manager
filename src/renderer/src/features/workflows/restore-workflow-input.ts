import type { Workflow } from '@contracts/workflows'
import type { WorkflowRun, StartWorkflowRun } from '@contracts/workflow-runs'
import type { Asset } from '@contracts/assets'

export interface RestoredWorkflowInput { values: StartWorkflowRun['values']; instance: StartWorkflowRun['instance']; names: Record<string, string>; warnings: string[] }

export function restoreWorkflowInput(workflow: Workflow, run: WorkflowRun, assets: Asset[]): RestoredWorkflowInput | null {
  if (!run.input) return null
  if (run.workflowId !== workflow.id) throw new Error('历史记录不属于当前工作流')
  const restored: RestoredWorkflowInput = { values: {}, instance: run.input.instance, names: {}, warnings: [] }
  for (const field of workflow.form?.fields ?? []) {
    const original = run.input.fields.find((item) => item.key === field.key)
    const value = run.input.values[field.key]
    if (!original || original.type !== field.type || value === undefined) { restored.warnings.push(`${field.title}：字段已变化，请重新填写`); continue }
    if (field.type === 'audio' || field.type === 'image') {
      if (typeof value !== 'object') { restored.warnings.push(`${field.title}：原记录缺少有效素材，请重新选择`); continue }
      const asset = assets.find((item) => item.id === value.assetId && !item.archived && item.kind === field.type && item.projectId === null)
      if (!asset || asset.updatedAt !== value.expectedUpdatedAt) { restored.warnings.push(`${field.title}：参考素材缺失或已更新，请重新选择`); continue }
      restored.names[field.key] = asset.name
    } else if (typeof value !== (field.type === 'text' ? 'string' : field.type)) { restored.warnings.push(`${field.title}：参数类型不一致，请重新填写`); continue }
    restored.values[field.key] = value
  }
  if (run.input.fields.some((field) => !workflow.form?.fields.some((item) => item.key === field.key))) restored.warnings.push('部分旧字段已移除，未回填这些字段')
  return restored
}
