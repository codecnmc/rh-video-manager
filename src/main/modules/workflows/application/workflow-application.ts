import type { WorkflowApplication, WorkflowFormDefinition } from '../../../../shared/contracts/workflows'

export function suggestWorkflowApplication(form: WorkflowFormDefinition): WorkflowApplication {
  return { updatedAt: '', needsReview: false, fields: form.fields.map((field): WorkflowApplication['fields'][number] => {
    const name = field.title.split(' · ').at(-1) ?? ''
    const content = field.type === 'text' && /^(text|prompt|description|instruction|positive|negative|voice_description)$/i.test(name)
    const label = field.type === 'audio' ? '参考音频' : field.type === 'image' ? '参考图片'
      : content ? field.title.split(' · ').slice(0, -1).join(' · ') || field.title : field.title
    return { key: field.key, label: label.slice(0, 150), visibility: field.type === 'audio' || field.type === 'image' || content ? 'common' : 'advanced',
      control: field.type === 'text' ? content ? 'multiline' : 'singleline' : 'native', defaultValue: field.defaultValue }
  }) }
}

export function reconcileWorkflowApplication(form: WorkflowFormDefinition, previous?: WorkflowApplication | null, previousForm?: WorkflowFormDefinition | null): WorkflowApplication {
  const suggestion = suggestWorkflowApplication(form)
  // 仅稳定字段标识匹配时保留配置；新增字段使用建议值，删除字段不移接到其他节点。
  const order = [...(previous?.fields.map((field) => field.key) ?? []), ...suggestion.fields.map((field) => field.key)]
  const fields = suggestion.fields.map((field) => {
    const old = previous?.fields.find((item) => item.key === field.key)
    const type = form.fields.find((item) => item.key === field.key)?.type
    const previousType = previousForm?.fields.find((item) => item.key === field.key)?.type
    return old && type === previousType && typeof old.defaultValue === typeof field.defaultValue ? old : field
  }).sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key))
  return { ...suggestion, updatedAt: new Date().toISOString(), needsReview: true, fields }
}
