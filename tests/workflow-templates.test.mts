import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WorkflowService } from '../src/main/modules/workflows/application/workflow-service.ts'
import { workflowTemplateSchema } from '../src/shared/contracts/workflows.ts'

test('导出加速与声音模板，不写入账号工作流', () => {
  let writes = 0
  const service = new WorkflowService({ list: () => [], save: () => { writes++ }, remove: () => { writes++ } },
    { inspect: async () => { throw new Error('不应联网') } }, () => 'unused', 'standard-content', 'accelerated-content', { 'qwen3-voice-design': 'qwen3-content', 'voxcpm2-voice-clone': 'voxcpm2-content' })
  assert.equal(service.exportTemplate(), 'accelerated-content')
  assert.equal(service.exportTemplate('accelerated'), 'accelerated-content')
  assert.equal(service.exportTemplate('qwen3-voice-design'), 'qwen3-content')
  assert.equal(service.exportTemplate('voxcpm2-voice-clone'), 'voxcpm2-content')
  assert.equal(workflowTemplateSchema.safeParse('standard').success, false)
  assert.equal(writes, 0)
  assert.equal(workflowTemplateSchema.safeParse('../private.json').success, false)
})

test('内置加速版为可导入画布，含启用预览和唯一成片，清除用户内容及无效色度', () => {
  const text = readFileSync(new URL('../src/main/providers/runninghub/h3-accelerated-template.json', import.meta.url), 'utf8')
  const graph = JSON.parse(text) as { nodes: { type: string; mode: number; widgets_values: unknown[]; inputs: { name: string; link?: number | null }[] }[] }
  const preview = graph.nodes.find((node) => node.type === 'ModelPreviewOverrideKJ')!
  assert.equal(preview.mode, 0)
  assert.ok(preview.inputs.find((input) => input.name === 'model')?.link)
  assert.equal(graph.nodes.filter((node) => node.type === 'SaveVideo').length, 1)
  assert.equal(graph.nodes.some((node) => node.type === 'VHS_VideoCombine'), false)
  assert.equal(graph.nodes.find((node) => node.type === 'CreateVideo')?.widgets_values[3], 'auto')
  assert.equal(graph.nodes.find((node) => node.type === 'CreateVideo')?.widgets_values[4], 'none')
  assert.equal(graph.nodes.find((node) => node.type === 'Text')?.widgets_values[0], '')
  assert.equal(/https?:\/\/|data:image|data:video|webhook/i.test(text), false)
})
