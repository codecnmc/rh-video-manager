import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedMediaUrl, allowedSocketUrl, parseOutput as parseWorkflowOutput, parseSampling as parseWorkflowSampling } from '../src/main/providers/runninghub/preview-protocol.ts'
import { inspectWorkflowPreview, classifyWorkflowVideo } from '../src/main/providers/runninghub/workflow-preview.ts'
import { h3PromptSchema, h3Sections } from '../src/shared/contracts/h3.ts'

function onlineResponse(sampling = '301', draft = '279', final = '274') {
  return { code: 0, data: { prompt: JSON.stringify({
    [sampling]: { class_type: 'ModelPreviewOverrideKJ', inputs: {} },
    [draft]: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '_Minimax_H3_', format: 'video/h264-mp4', save_output: true } },
    [final]: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '_Minimax_H3_Upscale_', format: 'video/h264-mp4', save_output: true } }
  }) } }
}

const definition = inspectWorkflowPreview(onlineResponse())
const parseSampling = (value: unknown) => parseWorkflowSampling(value, definition)
const parseOutput = (node: string, value: unknown) => parseWorkflowOutput(node, value, definition)

test('线上 API prompt 字符串决定预览节点，不依赖本地参考编号', () => {
  const online = inspectWorkflowPreview(onlineResponse('901', '902', '903'))
  assert.deepEqual(online.capabilities, { status: 'ready', sampling: true, draft: true, final: true, unclassifiedOutputs: 0 })
  assert.ok(parseWorkflowSampling({ node_id: '901', step: 0, total: 12 }, online))
  assert.equal(parseWorkflowSampling({ node_id: '301', step: 0, total: 12 }, online), null)
  const output = { videos: [{ url: 'https://rh-images.xiaoyaoyou.com/result.mp4' }] }
  assert.equal(parseWorkflowOutput('902', output, online)?.kind, 'draft')
  assert.equal(parseWorkflowOutput('903', output, online)?.kind, 'final')
  assert.equal(parseWorkflowOutput('279', output, online), null)
  assert.equal(classifyWorkflowVideo('https://rh-images.xiaoyaoyou.com/_Minimax_H3_Upscale_0001.mp4', online), 'final')
  assert.equal(classifyWorkflowVideo('https://rh-images.xiaoyaoyou.com/_Minimax_H3_0001.mp4', online), 'draft')
  assert.equal(classifyWorkflowVideo('https://rh-images.xiaoyaoyou.com/unknown.mp4', online), null)
})

test('不存在预览节点与线上读取失败是不同状态，普通输出不猜角色', () => {
  const online = inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify({
    '11': { class_type: 'KSampler', inputs: {}, _meta: { title: 'ModelPreviewOverrideKJ' } },
    '12': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: 'plain', format: 'video/h264-mp4' } },
    '13': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '_Minimax_H3_', format: 'video/h264-mp4', save_output: false } },
    '14': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '_Minimax_H3_Upscale_', format: 'image/gif' } },
    '15': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '_Minimax_H3_%date:unknown%', format: 'video/h264-mp4' } }
  }) } })
  assert.deepEqual(online.capabilities, { status: 'ready', sampling: false, draft: false, final: false, unclassifiedOutputs: 3 })
  assert.throws(() => inspectWorkflowPreview({ code: 1, data: { prompt: '{}' } }))
  assert.throws(() => inspectWorkflowPreview({ code: 0, data: { prompt: 'broken json' } }))
  assert.throws(() => inspectWorkflowPreview({ code: 0, data: { prompt: '{}'.repeat(1024 * 1024 + 1) } }))
  assert.throws(() => inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify({ nodes: [] }) } }))
})

test('日期模板和无尾下划线角色可识别，未知表达式和放大角色不误归低清', () => {
  const online = inspectWorkflowPreview({ code: 0, data: { prompt: JSON.stringify({
    draft: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '%date:yyyyMMdd_hhmmss%_Minimax_H3', format: 'video/h264-mp4' } },
    final: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '%date:yyyyMMdd_hhmmss%_Minimax_H3_Upscale', format: 'video/h264-mp4' } }
  }) } })
  assert.equal(online.capabilities.draft, true)
  assert.equal(online.capabilities.final, true)
  assert.equal(online.capabilities.unclassifiedOutputs, 0)
  const base = 'https://rh-images.xiaoyaoyou.com/output/20261020_113429_Minimax_H3'
  assert.equal(classifyWorkflowVideo(`${base}_00001.mp4`, online), 'draft')
  assert.equal(classifyWorkflowVideo(`${base}_Upscale_00001.mp4`, online), 'final')
  assert.equal(classifyWorkflowVideo(`${base}_Upscale_00001.mp4`, { ...online, videoOutputs: online.videoOutputs.filter((output) => output.kind === 'draft') }), null)
  assert.equal(classifyWorkflowVideo(`${base}Wrong_00001.mp4`, online), null)
  assert.equal(classifyWorkflowVideo('https://rh-images.xiaoyaoyou.com/unknown.mp4', online), null)
})

test('KJ 元数据消息不冒充采样媒体', () => {
  assert.deepEqual(parseSampling({ node_id: '301', step: 0, total: 12 }), { step: 0, total: 12, media: null })
  assert.equal(parseSampling({ node_id: '999', step: 1, total: 12 }), null)
  assert.equal(parseSampling({ node_id: '301', step: 13, total: 12 }), null)
})

test('KJ 接纳匹配签名的 JPEG、WebP 和 MP4，拒绝伪造类型', () => {
  for (const [mime, bytes] of [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
    ['video/mp4', Buffer.from([0, 0, 0, 16, 102, 116, 121, 112])]
  ] as const) {
    assert.equal(parseSampling({ node_id: '301', step: 1, total: 12, image: bytes.toString('base64'), mime })?.media?.mime, mime)
  }
  assert.equal(parseSampling({ node_id: '301', step: 1, total: 12, mime: 'video/mp4', image: Buffer.from('not a video').toString('base64') }), null)
  assert.equal(parseSampling({ node_id: '301', step: 1, total: 12, image: 'data:image/svg+xml,unsafe' }), null)
})

test('低清输出与最终输出隔离；拒绝未知节点和本机 URL', () => {
  const output = { gifs: [{ cos_url: 'https://rh-images.xiaoyaoyou.com/output/example.mp4' }] }
  assert.equal(parseOutput('279', output)?.kind, 'draft')
  assert.equal(parseOutput('274', output)?.kind, 'final')
  assert.equal(parseOutput('301', output), null)
  assert.equal(parseOutput('279', { gifs: [{ url: 'https://127.0.0.1/private.mp4' }] }), null)
  assert.equal(parseOutput('279', { gifs: [{ filename: 'preview.mp4' }] }), null)
})

test('媒体和 WebSocket 限制域名及协议', () => {
  assert.equal(allowedMediaUrl('https://rh-images.xiaoyaoyou.com/output/video.mp4'), true)
  assert.equal(allowedMediaUrl('https://rh-comfyui01.tos-cn-beijing.volces.com/output/video.mp4?signature=example'), true)
  assert.equal(allowedMediaUrl('https://rh-comfyui01.tos-cn-beijing.volces.com.attacker.invalid/video.mp4'), false)
  assert.equal(allowedMediaUrl('https://other.tos-cn-beijing.volces.com/video.mp4'), false)
  assert.equal(allowedMediaUrl('http://rh-comfyui01.tos-cn-beijing.volces.com/video.mp4'), false)
  assert.equal(allowedMediaUrl('https://rh-comfyui01.tos-cn-beijing.volces.com:8443/video.mp4'), false)
  assert.equal(allowedMediaUrl('https://rh-images.xiaoyaoyou.com.attacker.invalid/video.mp4'), false)
  assert.equal(allowedMediaUrl('https://user:password@rh-images.xiaoyaoyou.com/video.mp4'), false)
  assert.equal(allowedSocketUrl('wss://www.runninghub.cn/ws?clientId=example'), true)
  assert.equal(allowedSocketUrl('ws://www.runninghub.cn/ws'), false)
  assert.equal(allowedSocketUrl('wss://localhost/ws'), false)
})

test('H3 草稿结构检查拒绝缺段、重段、乱序及空段', () => {
  const valid = h3Sections.map((section) => `${section}:\nExample content.`).join('\n\n')
  assert.equal(h3PromptSchema.safeParse(valid).success, true)
  assert.equal(h3PromptSchema.safeParse('').success, false)
  assert.equal(h3PromptSchema.safeParse(`${valid}\nsummary: duplicated`).success, false)
  assert.equal(h3PromptSchema.safeParse(h3Sections.map((section) => `${section}:`).join('\n')).success, false)
  assert.equal(h3PromptSchema.safeParse([...h3Sections].reverse().map((section) => `${section}: content`).join('\n')).success, false)
})
