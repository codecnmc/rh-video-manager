import { createHash } from 'node:crypto'
import { z } from 'zod'
import { workflowFormSchema, type WorkflowFormDefinition } from '../../../shared/contracts/workflows'

export function inspectWorkflowBindings(response: unknown) {
  const envelope = z.object({ code: z.literal(0), data: z.object({ prompt: z.string().min(1).max(2 * 1024 * 1024) }) }).parse(response)
  const graph = z.record(z.string().min(1).max(100), z.object({ class_type: z.string().max(200), _meta: z.object({ title: z.string().max(200).nullish() }).nullish(), inputs: z.record(z.string(), z.unknown()).default({}) })).parse(JSON.parse(envelope.data.prompt) as unknown)
  if (Object.keys(graph).length > 5000) throw new Error('工作流节点过多')
  const fields: WorkflowFormDefinition['fields'] = []
  const bindings: { key: string; nodeId: string; field: string }[] = []
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      // 节点连线不是用户输入；仅采纳实际的简单值，不执行表达式或猜测选项范围。
      if (/api.?key|token|secret|password|webhook|cookie|authorization/i.test(field)) continue
      if (typeof value === 'string' && /https?:\/\//i.test(value)) continue
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
      const type = node.class_type === 'LoadImage' && field === 'image' ? 'image'
        : node.class_type === 'LoadAudio' && field === 'audio' ? 'audio' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'
      fields.push({ key: `input-${createHash('sha256').update(JSON.stringify([nodeId, field])).digest('hex').slice(0, 32)}`, title: `${node._meta?.title ?? node.class_type} · ${field}`, type, defaultValue: value })
      bindings.push({ key: fields.at(-1)!.key, nodeId, field })
    }
  }
  return { form: workflowFormSchema.parse({ fields, inspectedAt: new Date().toISOString() }), bindings }
}
export function inspectWorkflowForm(response: unknown): WorkflowFormDefinition { return inspectWorkflowBindings(response).form }
