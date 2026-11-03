import type { ClipColor } from './contracts/assembly'

export const neutralClipColor: Readonly<ClipColor> = Object.freeze({
  brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0
})

export function hasClipColor(color?: ClipColor): boolean {
  return color !== undefined && (Object.keys(neutralClipColor) as (keyof ClipColor)[])
    .some((key) => color[key] !== neutralClipColor[key])
}

// 两端均在 sRGB 分量上先做饱和度/增益矩阵并截断，再做亮度偏移并截断。
export function clipColorTransform(color: ClipColor = neutralClipColor): { matrix: number[]; offset: number } {
  const weights = [0.2126, 0.7152, 0.0722]
  const gains = [1 + color.temperature, 1 + color.tint, 1 - color.temperature]
  const matrix = gains.flatMap((gain, row) => weights.map((weight, column) =>
    gain * color.contrast * (weight * (1 - color.saturation) + (row === column ? color.saturation : 0))))
  return { matrix, offset: color.brightness + (1 - color.contrast) / 2 }
}

export function clipColorSvgMatrix(color: ClipColor): string {
  const { matrix } = clipColorTransform(color)
  return [0, 1, 2].flatMap((row) => [...matrix.slice(row * 3, row * 3 + 3), 0, 0])
    .concat([0, 0, 0, 1, 0]).join(' ')
}

export function clipColorFfmpegFilter(color?: ClipColor): string {
  if (!color || !hasClipColor(color)) return ''
  const { matrix, offset } = clipColorTransform(color)
  const names = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb']
  const channels = names.map((name, index) => `${name}=${matrix[index]!.toFixed(8)}`).join(':')
  const shift = `clip(val+(${offset.toFixed(8)})*maxval,0,maxval)`
  return `format=gbrp,colorchannelmixer=${channels},lutrgb=r='${shift}':g='${shift}':b='${shift}'`
}
