import type { Workflow } from '@contracts/workflows'
import type { StartWorkflowRun } from '@contracts/workflow-runs'

export function workflowInputState(workflow: Workflow, values: StartWorkflowRun['values'], instance: StartWorkflowRun['instance']): string {
  // 比较实际表单值，而非是否曾填过字段；改回原值也应恢复为未修改。
  return JSON.stringify({ instance, fields: (workflow.form?.fields ?? []).map((field) => {
    const setting = workflow.application?.fields.find((item) => item.key === field.key)
    return [field.key, setting?.visibility === 'fixed' ? setting.defaultValue : values[field.key] ?? setting?.defaultValue ?? field.defaultValue]
  }) })
}
