import type { ImageNode } from '../../../../shared/contracts/image-generation'

type ImageSize = ImageNode['size']
export const imageRatios = ['1:1', '16:9', '9:16', '16:10'] as const
export type ImageRatio = typeof imageRatios[number]

interface ImageSizeOption { ratio: ImageRatio; tier: string; longEdge: number }

export const imageSizeOptions = {
  '1024x1024': { ratio: '1:1', tier: '1K', longEdge: 1024 },
  '1280x720': { ratio: '16:9', tier: '高清', longEdge: 1280 },
  '720x1280': { ratio: '9:16', tier: '高清', longEdge: 1280 },
  '1280x800': { ratio: '16:10', tier: '高清', longEdge: 1280 },
  '2048x2048': { ratio: '1:1', tier: '2K', longEdge: 2048 },
  '2048x1152': { ratio: '16:9', tier: '2K', longEdge: 2048 },
  '1152x2048': { ratio: '9:16', tier: '2K', longEdge: 2048 },
  '2560x1600': { ratio: '16:10', tier: '2.5K', longEdge: 2560 },
  '2880x2880': { ratio: '1:1', tier: '近 3K', longEdge: 2880 },
  '3840x2160': { ratio: '16:9', tier: '4K', longEdge: 3840 },
  '2160x3840': { ratio: '9:16', tier: '4K', longEdge: 3840 },
  '3584x2240': { ratio: '16:10', tier: '3.5K', longEdge: 3584 }
} as const satisfies Record<ImageSize, ImageSizeOption>

export function sizesForRatio(ratio: ImageRatio): ImageSize[] {
  return (Object.keys(imageSizeOptions) as ImageSize[]).filter((size) => imageSizeOptions[size].ratio === ratio)
}

export function sizeForRatio(current: ImageSize, ratio: ImageRatio): ImageSize {
  const previous = imageSizeOptions[current]
  const candidates = sizesForRatio(ratio)
  // 优先保留同一档位；该比例没有同档位时选最接近的实际长边，绝不构造协议外尺寸。
  return candidates.find((size) => imageSizeOptions[size].tier === previous.tier)
    ?? candidates.reduce((closest, size) => Math.abs(imageSizeOptions[size].longEdge - previous.longEdge) < Math.abs(imageSizeOptions[closest].longEdge - previous.longEdge) ? size : closest)
}
