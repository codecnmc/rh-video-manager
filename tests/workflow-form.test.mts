import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorkflowForm } from '../src/main/providers/runninghub/workflow-form.ts'

test('动态表单识别简单类型和媒体字段，不暴露节点连线与凭据', () => {
  const result = inspectWorkflowForm({ code: 0, data: { prompt: JSON.stringify({
    '12': { class_type: 'LoadAudio', inputs: { audio: 'reference.wav' } },
    '21': { class_type: 'Text', inputs: { text: '台词', seed: 123, enabled: true, source: ['12', 0], api_key: 'private', endpoint: 'https://private.example' } }
  }) } })
  assert.deepEqual(result.fields.map((field) => field.type), ['audio', 'text', 'number', 'boolean'])
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(result.fields.some((field) => 'nodeId' in field), false)
  assert.equal(new Set(result.fields.map((field) => field.key)).size, result.fields.length)
})

test('拒绝平台失败响应，不生成成功表单', () => {
  assert.throws(() => inspectWorkflowForm({ code: 1, data: { prompt: '{}' } }))
})
