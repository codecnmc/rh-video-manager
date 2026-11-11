import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowInputState } from '../src/renderer/src/features/workflows/workflow-input-state.ts'
import type { Workflow } from '../src/shared/contracts/workflows.ts'

const workflow: Workflow = { id: 'workflow', accountId: 'account', name: '声音', workflowId: 'online', enabled: true, isDefault: false, capabilities: null, checkedAt: 'now', error: '',
  form: { inspectedAt: 'now', fields: [{ key: 'text', title: '台词', type: 'text', defaultValue: '默认台词' }] } }

test('默认值和显式填写相同值视为一致，回填作为独立基准', () => {
  assert.equal(workflowInputState(workflow, {}, 'default'), workflowInputState(workflow, { text: '默认台词' }, 'default'))
  const baseline = workflowInputState(workflow, { text: '历史台词' }, 'plus')
  assert.equal(baseline, workflowInputState(workflow, { text: '历史台词' }, 'plus'))
  assert.notEqual(baseline, workflowInputState(workflow, { text: '修改台词' }, 'plus'))
  assert.notEqual(baseline, workflowInputState(workflow, { text: '历史台词' }, 'ultra'))
})
