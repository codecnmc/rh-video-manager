import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowService } from '../src/main/modules/workflows/application/workflow-service.ts'
import { WorkflowRunService } from '../src/main/modules/workflows/application/workflow-run-service.ts'
import { inspectWorkflowForm } from '../src/main/providers/runninghub/workflow-form.ts'
import type { Workflow } from '../src/shared/contracts/workflows.ts'
import type { WorkflowRun } from '../src/shared/contracts/workflow-runs.ts'

const id = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'
const form = inspectWorkflowForm({ code: 0, data: { prompt: JSON.stringify({
  '10': { class_type: 'Text', _meta: { title: '输入台词' }, inputs: { text: '你好' } },
  '20': { class_type: 'Model', inputs: { seed: 123 } }
}) } })
function setup() {
  let row: Workflow = { id, accountId, name: '声音设计', workflowId: '2120361636077850626', kind: 'audio', enabled: true,
    isDefault: false, checkedAt: 'checked', error: '', capabilities: null, form }
  const service = new WorkflowService({ list: () => [structuredClone(row)], save: (value) => { row = structuredClone(value) }, remove: () => undefined },
    { inspect: async () => { throw new Error('不用视频检测') }, inspectForm: async () => ({ ...form, fields: form.fields.slice(0, 1) }) }, () => id)
  return service
}

test('字段配置保存至仓储，拒绝过期修订及丢失字段', () => {
  const service = setup()
  const workflow = service.get(id)
  const fields = workflow.application!.fields
  assert.equal(fields[0]!.visibility, 'common')
  assert.equal(fields[1]!.visibility, 'advanced')
  const input = { id, expectedCheckedAt: 'checked', expectedUpdatedAt: '', fields }
  assert.throws(() => service.saveApplication({ ...input, fields: fields.slice(0, 1) }))
  service.saveApplication(input)
  assert.ok(service.get(id).application!.updatedAt)
  assert.throws(() => service.saveApplication(input), /更新/)
})

test('线上字段变化保留稳定映射并要求人工复核', async () => {
  const service = setup()
  const fields = service.get(id).application!.fields.map((field) => ({ ...field, label: '自定义名称' }))
  service.saveApplication({ id, expectedCheckedAt: 'checked', expectedUpdatedAt: '', fields })
  await service.inspect(id, 'unused')
  assert.equal(service.get(id).application!.needsReview, true)
  assert.equal(service.get(id).application!.fields.length, 1)
  assert.equal(service.get(id).application!.fields[0]!.label, '自定义名称')
})

test('固定参数在主进程覆盖请求值，过期应用配置阻断提交', async () => {
  const workflows = setup()
  workflows.saveApplication({ id, expectedCheckedAt: 'checked', expectedUpdatedAt: '', fields: workflows.get(id).application!.fields.map((field, index) => index === 1 ? { ...field, visibility: 'fixed', defaultValue: 456 } : field) })
  const rows: WorkflowRun[] = []
  let prepared: unknown
  const runs = new WorkflowRunService({ list: () => rows, save: (run) => { const index = rows.findIndex((item) => item.id === run.id); if (index === -1) rows.push(structuredClone(run)); else rows[index] = structuredClone(run) } }, {
    workflow: () => workflows.get(id), assertCapacity: async () => undefined,
    prepare: async (_workflow, values) => { prepared = values; return { form, submit: async () => '2120361636077850627' } },
    query: async () => ({ status: 'running', outputs: [] }), archive: async () => { throw new Error('不用归档') }
  })
  const input = { requestId: '33333333-3333-4333-8333-333333333333', workflowId: id, expectedCheckedAt: 'checked', instance: 'default' as const, confirmed: true as const,
    values: { [form.fields[1]!.key]: 999 } }
  await assert.rejects(runs.start(input), /配置已变化/)
  await runs.start({ ...input, expectedApplicationUpdatedAt: workflows.get(id).application!.updatedAt })
  assert.deepEqual(prepared, { [form.fields[0]!.key]: form.fields[0]!.defaultValue, [form.fields[1]!.key]: 456 })
})

test('节点新增及输入排序不会改变原字段标识', () => {
  const changed = inspectWorkflowForm({ code: 0, data: { prompt: JSON.stringify({
    '5': { class_type: 'Model', inputs: { enabled: true } },
    '20': { class_type: 'Model', inputs: { seed: 123 } },
    '10': { class_type: 'Text', _meta: { title: '输入台词' }, inputs: { text: '你好' } }
  }) } })
  for (const field of form.fields) assert.equal(changed.fields.find((item) => item.title === field.title)!.key, field.key)
})
