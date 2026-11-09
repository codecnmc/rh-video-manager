import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prepareH3Graph, RunningHubGenerationGateway } from '../src/main/providers/runninghub/generation-gateway.ts'
import { GenerationRejectedError } from '../src/main/modules/jobs/ports/generation.ts'
import type { VideoDraft } from '../src/shared/contracts/video.ts'
import type { DraftReference, ReferenceKind } from '../src/shared/contracts/references.ts'

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>
const draft: VideoDraft = { id: randomUUID(), title: '原生 H3 协议', description: '', prompt: '<Picture 4> <Audio 2>', promptDocument: '', duration: 5, resolution: '720P', aspectRatio: '9:16', instance: 'default', instanceMode: 'auto' }
function graph(): Graph {
  return {
    reference: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: ['text', 0], width: ['canvas', 0], height: ['canvas', 1], length: ['math', 1], ref_image_size: 'match', clip: ['clip', 0], vae: ['vae', 0], audio_vae: ['audioVae', 0],
      'ref_images.ref_image_0': ['image', 0], 'ref_images.ref_image_1': ['unusedImage', 0], 'ref_videos.ref_video_0': ['videoLoader', 0], 'ref_audios.ref_audio_0': ['audioLoader', 0] } },
    canvas: { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '16:9 (Widescreen)', megapixels: 1.5, multiple: 32 } },
    clip: { class_type: 'CLIPLoader', inputs: {} }, vae: { class_type: 'VAELoader', inputs: {} }, audioVae: { class_type: 'VAELoader', inputs: {} },
    text: { class_type: 'Text', inputs: { text: '模板原文' } }, math: { class_type: 'ComfyMathExpression', inputs: { expression: '模板表达式' } },
    image: { class_type: 'LoadImage', inputs: { image: 'template.png' } }, unusedImage: { class_type: 'LoadImage', inputs: { image: 'example.png' } },
    videoLoader: { class_type: 'VHS_LoadVideo', inputs: { video: '', force_rate: 0, skip_first_frames: 0, select_every_nth: 1 } },
    audioLoader: { class_type: 'LoadAudio', inputs: { audio: 'None' } },
    preview: { class_type: 'ModelPreviewOverrideKJ', inputs: { model: ['model', 0], vae: ['vae', 0] } }, model: { class_type: 'UNETLoader', inputs: {} },
    sampler: { class_type: 'SelfLiftH3Sampler', inputs: { positive: ['reference', 0], latent_image: ['reference', 1], model: ['preview', 0], seed: 123, transition_step: 6 } },
    frames: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0] } }, audio: { class_type: 'VAEDecodeAudio', inputs: { samples: ['sampler', 0] } },
    video: { class_type: 'CreateVideo', inputs: { images: ['frames', 0], audio: ['audio', 0], fps: 24 } },
    output: { class_type: 'SaveVideo', inputs: { video: ['video', 0], filename_prefix: 'video/ComfyUI', format: 'auto' } }
  }
}
const envelope = (value: Graph) => ({ code: 0, data: { prompt: JSON.stringify(value) } })
test('仅兼容 CreateVideo 的旧色度 none，保留合法色度与编码器 none，未知值本地拒绝', () => {
  for (const chroma of ['none', 'auto', '444', '422', '420']) {
    const original = graph()
    Object.assign(original.video!.inputs, { chroma_subsampling: chroma, codec: 'none' })
    const plan = prepareH3Graph(envelope(original), draft)
    assert.equal(plan.graph.video!.inputs.chroma_subsampling, chroma === 'none' ? 'auto' : chroma)
    assert.equal(plan.graph.video!.inputs.codec, 'none')
    assert.equal(original.video!.inputs.chroma_subsampling, chroma)
  }
  for (const chroma of ['unknown', null, 420, ['external', 0]]) {
    const original = graph()
    original.video!.inputs.chroma_subsampling = chroma
    assert.throws(() => prepareH3Graph(envelope(original), draft), /色度采样参数/)
  }
})
function reference(kind: ReferenceKind, label: string): DraftReference {
  return { id: randomUUID(), draftId: draft.id, assetId: randomUUID(), kind, label, name: '受管素材', size: 10 }
}

test('原生 H3 连接推断不依赖 ID，图片与独立音频各自编号，清除空槽并保留采样设置', () => {
  const original = graph()
  const plan = prepareH3Graph(envelope(original), draft)
  assert.ok(plan.applyNativeMedia)
  assert.equal(plan.graph.reference!.inputs.length, 124)
  assert.equal(plan.graph.canvas!.inputs.aspect_ratio, '9:16 (Portrait Widescreen)')
  assert.equal(plan.graph.canvas!.inputs.megapixels, 0.9)
  assert.equal(plan.graph.unusedImage, undefined)
  plan.applyNativeMedia([{ reference: reference('image', '<Picture 4>'), filename: 'openapi/new.png' }, { reference: reference('audio', '<Audio 2>'), filename: 'openapi/new.mp3' }], '<Picture 1> <Audio 1>')
  const input = plan.graph.reference!.inputs
  const image = input['ref_images.ref_image_0'] as [string, number]
  const audio = input['ref_audios.ref_audio_0'] as [string, number]
  assert.equal(plan.graph[image[0]]!.inputs.image, 'openapi/new.png')
  assert.equal(plan.graph[audio[0]]!.inputs.audio, 'openapi/new.mp3')
  assert.equal(input['ref_images.ref_image_1'], undefined)
  assert.equal(input['ref_videos.ref_video_0'], undefined)
  assert.equal(input.embedded_media_json, undefined)
  assert.equal(input.prompt, '<Picture 1> <Audio 1>')
  assert.equal(plan.graph.sampler!.inputs.seed, 123)
  assert.deepEqual(plan.graph.sampler!.inputs.model, ['preview', 0])
  assert.deepEqual(original.reference!.inputs.prompt, ['text', 0])
  assert.equal(original.unusedImage!.inputs.image, 'example.png')
})

test('原生视频参考重采样至 24 fps，不混入模板空槽或配对原声音频', () => {
  const plan = prepareH3Graph(envelope(graph()), draft)
  plan.applyNativeMedia!([{ reference: reference('video', '<Video 1>'), filename: 'openapi/new.mp4' }], '<Video 1>')
  const link = plan.graph.reference!.inputs['ref_videos.ref_video_0'] as [string, number]
  assert.equal(plan.graph[link[0]]!.inputs.force_rate, 24)
  assert.equal(plan.graph[link[0]]!.inputs.video, 'openapi/new.mp4')
  assert.equal(plan.graph.reference!.inputs['ref_audios.ref_audio_0'], undefined)
})

test('不兼容画幅、帧率、多主节点及配对原声在准备阶段拒绝', () => {
  const mutations: ((value: Graph) => void)[] = [
    (value) => { value.reference!.inputs.height = ['otherCanvas', 1] },
    (value) => { value.video!.inputs.fps = 30 },
    (value) => { value.duplicate = structuredClone(value.reference!) },
    (value) => { value.reference!.inputs['ref_video_audios.ref_video_audio_0'] = ['videoLoader', 2] }
  ]
  for (const mutate of mutations) { const value = graph(); mutate(value); assert.throws(() => prepareH3Graph(envelope(value), draft)) }
})

test('原生创建使用线上副本且只调用一次；媒体映射失败不得发送创建请求', async () => {
  const originalFetch = globalThis.fetch
  const requests: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(JSON.stringify(String(url).endsWith('getJsonApiFormat') ? envelope(graph()) : { code: 0, data: { taskId: '1234567890123456789' } }))
  }
  try {
    const gateway = new RunningHubGenerationGateway()
    const plan = await gateway.prepare('123456789012', 'test-only-key', draft)
    await plan.create([{ reference: reference('image', '<Picture 4>'), filename: 'openapi/new.png' }, { reference: reference('audio', '<Audio 2>'), filename: 'openapi/new.mp3' }])
    assert.equal(requests.filter((item) => item.url.endsWith('/create')).length, 1)
    const submitted = JSON.parse(String(requests[1]!.body.workflow)) as Graph
    assert.equal(submitted.reference!.inputs.prompt, '<Picture 1> <Audio 1>')
    assert.equal(requests[1]!.body.instanceType, 'default')
    assert.equal(requests[1]!.body.webhookUrl, undefined)
    const invalid = await gateway.prepare('123456789012', 'test-only-key', draft)
    await assert.rejects(invalid.create(Array.from({ length: 10 }, (_, i) => ({ reference: reference('image', `<Picture ${i + 1}>`), filename: `openapi/${i}.png` }))), GenerationRejectedError)
    assert.equal(requests.filter((item) => item.url.endsWith('/create')).length, 1)
  } finally { globalThis.fetch = originalFetch }
})
