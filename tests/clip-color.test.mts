import test from 'node:test'
import assert from 'node:assert/strict'
import { clipColorSchema, assemblyClipSchema } from '../src/shared/contracts/assembly.ts'
import { clipColorFfmpegFilter, clipColorSvgMatrix, clipColorTransform, hasClipColor, neutralClipColor } from '../src/shared/clip-color.ts'

test('旧片段无调色字段保持兼容，默认不添加导出滤镜', () => {
  assert.equal(hasClipColor(), false)
  assert.equal(clipColorFfmpegFilter(), '')
  assert.equal(clipColorFfmpegFilter({ ...neutralClipColor }), '')
  assert.deepEqual(clipColorTransform().matrix, [1, 0, 0, 0, 1, 0, 0, 0, 1])
  const clip = assemblyClipSchema.parse({ id: 'f2018d01-0101-4010-8010-010101010101', assetId: 'f2018d01-0101-4010-8010-010101010102', title: '旧片段', sourceDuration: 8, inPoint: 0, outPoint: 8, prompt: '', originalAudio: true })
  assert.equal(clip.color, undefined)
})

test('矩阵和亮度偏移同时服务预览与导出，不接收任意滤镜文本', () => {
  const color = clipColorSchema.parse({ brightness: 0.01, contrast: 0.98, saturation: 0.96, temperature: -0.01, tint: 0 })
  assert.equal(hasClipColor(color), true)
  const transform = clipColorTransform(color)
  const svg = clipColorSvgMatrix(color).split(' ').map(Number)
  assert.equal(svg.length, 20)
  assert.deepEqual(svg.slice(0, 3), transform.matrix.slice(0, 3))
  assert.ok(Math.abs(transform.offset - 0.02) < 1e-10)
  const filter = clipColorFfmpegFilter(color)
  assert.ok(filter.includes(`rr=${transform.matrix[0]!.toFixed(8)}`))
  assert.ok(filter.includes('(0.02000000)*maxval'))
  assert.equal(clipColorSchema.safeParse({ ...color, temperature: Infinity }).success, false)
  assert.equal(clipColorSchema.safeParse({ ...color, saturation: 2.1 }).success, false)
  assert.equal(clipColorSchema.safeParse({ ...color, brightness: 'movie=remote' }).success, false)
})
