import test from 'node:test'
import assert from 'node:assert/strict'
import { imageSizeSchema } from '../src/shared/contracts/image-generation.ts'
import { imageRatios, imageSizeOptions, sizeForRatio, sizesForRatio } from '../src/renderer/src/features/image-generation/image-size-options.ts'

test('所有既有图片尺寸均有准确比例及档位，不增加协议外尺寸', () => {
  assert.deepEqual(Object.keys(imageSizeOptions).sort(), [...imageSizeSchema.options].sort())
  for (const size of imageSizeSchema.options) {
    const [width, height] = size.split('x').map(Number)
    const [ratioWidth, ratioHeight] = imageSizeOptions[size].ratio.split(':').map(Number)
    assert.equal(width! * ratioHeight!, height! * ratioWidth!)
    assert.equal(imageSizeOptions[size].longEdge, Math.max(width!, height!))
  }
})

test('9:16 的 2K 明确映射到 1152x2048，切换横竖保留档位', () => {
  assert.equal(sizeForRatio('2048x1152', '9:16'), '1152x2048')
  assert.equal(imageSizeOptions['1152x2048'].tier, '2K')
  assert.equal(sizeForRatio('2160x3840', '16:9'), '3840x2160')
  assert.deepEqual(sizesForRatio('9:16'), ['720x1280', '1152x2048', '2160x3840'])
})

test('缺少同档位时选择最接近的支持尺寸，已有草稿尺寸保持原值', () => {
  assert.equal(sizeForRatio('2048x1152', '16:10'), '2560x1600')
  for (const size of imageSizeSchema.options) {
    assert.equal(sizeForRatio(size, imageSizeOptions[size].ratio), size)
    for (const ratio of imageRatios) {
      const next = sizeForRatio(size, ratio)
      assert.ok(imageSizeSchema.safeParse(next).success)
      assert.equal(imageSizeOptions[next].ratio, ratio)
    }
  }
})
