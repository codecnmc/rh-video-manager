import type { AssemblyCanvas, AssemblyVersion, TitleVisual } from './contracts/assembly'

// libass 用 hhea 的升部减降部归一化字号，CSS 用 head.unitsPerEm。
// 补偿值来自随应用分发字体的实际表数据；替换字体时需同步更新。
export const titleFonts = {
  song: { label: '思源宋体', family: 'Noto Serif CJK SC', file: 'NotoSerifCJKsc-Regular.otf', assSizeScale: 1.437 },
  sans: { label: '思源黑体', family: 'Noto Sans CJK SC', file: 'NotoSansCJKsc-Regular.otf', assSizeScale: 1.448 }
} as const
export const defaultTitleVisual: TitleVisual = {
  kind: 'title', text: '', font: 'song', size: 9, foreground: '#f2f2ec', background: '#171717', surface: 'fabric'
}
export const defaultAssemblyCanvas: AssemblyCanvas = { width: 1280, height: 720, fit: 'contain' }

// 旧工程不写入隐式迁移；沿用首个视频尺寸。纯文字工程使用明确的默认画布。
export function resolveAssemblyCanvas(version: AssemblyVersion, source?: { width: number; height: number }): AssemblyCanvas {
  return version.canvas ?? (source ? { width: Math.ceil(source.width / 2) * 2, height: Math.ceil(source.height / 2) * 2, fit: 'contain' } : defaultAssemblyCanvas)
}

export function canvasFfmpegFilter(canvas: AssemblyCanvas): string {
  const { width, height, fit } = canvas
  return fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
}
