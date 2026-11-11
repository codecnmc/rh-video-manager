import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreWorkflowInput } from '../src/renderer/src/features/workflows/restore-workflow-input.ts'
import type { Workflow } from '../src/shared/contracts/workflows.ts'
import type { WorkflowRun } from '../src/shared/contracts/workflow-runs.ts'
import type { Asset } from '../src/shared/contracts/assets.ts'

const fields = [{ key: 'text', title: '台词', type: 'text' as const, defaultValue: '默认' }, { key: 'flag', title: '开关', type: 'boolean' as const, defaultValue: true },
  { key: 'number', title: '数字', type: 'number' as const, defaultValue: 1 }, { key: 'audio', title: '音频', type: 'audio' as const, defaultValue: '' }]
const workflow: Workflow = { id: 'workflow', accountId: 'account', workflowId: 'online', name: '声音', enabled: true, isDefault: false, kind: 'audio', form: { fields, inspectedAt: 'now' }, capabilities: null, checkedAt: 'now', error: '' }
const run: WorkflowRun = { id: 'run', workflowId: workflow.id, accountId: 'account', workflowName: '声音', kind: 'audio', status: 'success', taskId: 'task', createdAt: 'now', updatedAt: 'now', message: '', assets: [],
  input: { instance: 'plus', fields, values: { text: '', flag: false, number: 0, audio: { assetId: 'asset', expectedUpdatedAt: 'revision' } } } }
const asset: Asset = { id: 'asset', projectId: null, name: '参考.wav', kind: 'audio', size: 1, categoryId: null, tags: [], prompt: '', notes: '', archived: false, createdAt: 'now', updatedAt: 'revision' }

test('恢复台词、布尔、零值、档位及未变更的参考素材', () => {
  const restored = restoreWorkflowInput(workflow, run, [asset])!
  assert.deepEqual(restored.values, run.input!.values)
  assert.equal(restored.instance, 'plus')
  assert.equal(restored.names.audio, '参考.wav')
  assert.deepEqual(restored.warnings, [])
})
test('旧记录不伪造入参，素材版本或字段类型变化时提示重选', () => {
  assert.equal(restoreWorkflowInput(workflow, { ...run, input: undefined }, []), null)
  const restored = restoreWorkflowInput({ ...workflow, form: { fields: fields.map((field) => field.key === 'flag' ? { ...field, type: 'number', defaultValue: 1 } : field), inspectedAt: 'new' } }, run, [{ ...asset, updatedAt: 'new' }])!
  assert.equal(restored.values.audio, undefined)
  assert.equal(restored.values.flag, undefined)
  assert.equal(restored.warnings.length, 2)
})
