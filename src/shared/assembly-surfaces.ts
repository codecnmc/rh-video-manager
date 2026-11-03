import type { FrameMask, TitleSurface } from './contracts/assembly-effects'
import type { TitleVisual } from './contracts/assembly'

export const defaultFilmMask: FrameMask = { kind: 'rounded', inset: 3, radius: 14, feather: 3, strength: 1 }
export const titlePresets: Record<string, { label: string; visual: TitleVisual }> = {
  plain: { label: '素色文字卡', visual: { kind: 'title', text: '', font: 'song', size: 8, foreground: '#ffffff', background: '#000000', surface: 'plain' } },
  'silent-opening': { label: '默片 · 旧纸片头', visual: { kind: 'title', text: '', font: 'song', size: 14, foreground: '#242424', background: '#aaa9a3', surface: 'paper' } },
  'silent-dialogue': { label: '默片 · 黑底宋体插卡', visual: { kind: 'title', text: '', font: 'song', size: 9, foreground: '#f2f2ec', background: '#171717', surface: 'fabric' } }
}

// 两个适配器共享像素算法：预览交给 Worker，导出落为临时 PNG，不使用外部纹理或 CDN。
export function surfacePixels(width: number, height: number, background: string, surface: TitleSurface): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const channels = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16))
  let seed = 90271027
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = (seed / 0xffffffff - 0.5) * (surface === 'paper' ? 22 : surface === 'fabric' ? 10 : 0)
    const weave = surface === 'fabric' ? Math.sin(x * 2.1 + y * 0.5) * 2 : 0
    const edge = surface === 'plain' ? 0 : Math.max(0, Math.hypot(x / width - 0.5, y / height - 0.5) - 0.2) * 18
    const offset = (y * width + x) * 4
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.max(0, Math.min(255, channels[channel]! + noise + weave - edge))
    pixels[offset + 3] = 255
  }
  return pixels
}

export function maskPixels(width: number, height: number, mask: FrameMask): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const unit = Math.min(width, height) / 100
  const inset = mask.inset * unit
  const radius = Math.min(mask.radius * unit, width / 2 - inset, height / 2 - inset)
  const feather = Math.max(0.5, mask.feather * unit)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const qx = Math.abs(x + 0.5 - width / 2) - (width / 2 - inset - radius)
    const qy = Math.abs(y + 0.5 - height / 2) - (height / 2 - inset - radius)
    const distance = mask.kind === 'ellipse'
      ? (Math.hypot((x + 0.5 - width / 2) / (width / 2 - inset), (y + 0.5 - height / 2) / (height / 2 - inset)) - 1) * Math.min(width / 2 - inset, height / 2 - inset)
      : Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
    pixels[(y * width + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, 0.5 + distance / feather)) * mask.strength * 255)
  }
  return pixels
}

export type AssemblyRasterRequest = { width: number; height: number } & (
  { kind: 'mask'; mask: FrameMask } | { kind: 'surface'; background: string; surface: TitleSurface }
)
export function assemblyRaster(request: AssemblyRasterRequest): Uint8ClampedArray<ArrayBuffer> {
  return request.kind === 'mask' ? maskPixels(request.width, request.height, request.mask)
    : surfacePixels(request.width, request.height, request.background, request.surface)
}
