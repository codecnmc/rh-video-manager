import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorkflowPreview, classifyWorkflowVideo, restoreWorkflowPreviewDefinition } from '../src/main/providers/runninghub/workflow-preview.ts'

function nativeGraph(): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  // 使用不同于用户文件的 ID，验证识别依据连接而非固定编号。
  return {
    reference: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: {} },
    sampler: { class_type: 'SelfLiftH3Sampler', inputs: { positive: ['reference', 0], latent_image: ['reference', 1] } },
    frames: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0] } },
    audio: { class_type: 'VAEDecodeAudio', inputs: { samples: ['sampler', 0] } },
    video: { class_type: 'CreateVideo', inputs: { images: ['frames', 0], audio: ['audio', 0] } },
    output: { class_type: 'SaveVideo', inputs: { video: ['video', 0], filename_prefix: 'video/ComfyUI', format: 'auto' } }
  }
}

function inspect(graph: ReturnType<typeof nativeGraph>) {
  return inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify(graph) } })
}

test('原生 H3 唯一完整输出识别为成片，快照恢复及结果匹配保持角色', () => {
  const definition = inspect(nativeGraph())
  assert.deepEqual(definition.capabilities, { status: 'ready', sampling: false, draft: false, final: true, unclassifiedOutputs: 0 })
  assert.deepEqual(definition.videoOutputs, [{ nodeId: 'output', kind: 'final', prefix: 'ComfyUI' }])
  const restored = restoreWorkflowPreviewDefinition(JSON.parse(JSON.stringify(definition)))
  assert.equal(classifyWorkflowVideo('https://example.com/ComfyUI_00001_.mp4', restored), 'final')
  assert.equal(classifyWorkflowVideo('https://example.com/Other_00001_.mp4', restored), null)
})

test('多输出、断链、错误插槽和不同音频来源不推断成片', () => {
  const mutations: ((graph: ReturnType<typeof nativeGraph>) => void)[] = [
    (graph) => { graph.second = { class_type: 'SaveVideo', inputs: { ...graph.output!.inputs, filename_prefix: 'other' } } },
    (graph) => { graph.video!.inputs.images = ['missing', 0] },
    (graph) => { graph.sampler!.inputs.latent_image = ['reference', 0] },
    (graph) => { graph.audio!.inputs.samples = ['another-sampler', 0] },
    (graph) => { graph.output!.inputs.video = ['video', 1] },
    (graph) => { graph.output!.inputs.format = 'webm' },
    (graph) => { graph.reference!.class_type = 'OtherReferenceNode' }
  ]
  for (const mutate of mutations) {
    const graph = nativeGraph()
    mutate(graph)
    const definition = inspect(graph)
    assert.equal(definition.capabilities.final, false)
    assert.equal(definition.capabilities.draft, false)
    assert.equal(definition.capabilities.unclassifiedOutputs, graph.second ? 2 : 1)
  }
})
