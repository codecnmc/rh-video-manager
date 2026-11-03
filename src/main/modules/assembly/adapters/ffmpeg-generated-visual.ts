import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssemblyCanvas, GeneratedVisual, TitleVisual } from '../../../../shared/contracts/assembly'
import { titleFonts } from '../../../../shared/assembly-visual'
import { layoutTitle } from '../../../../shared/title-layout'
import { writeAssemblyRaster } from './assembly-raster-png'

const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`

export function escapeAssText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}').replace(/\r\n?|\n/g, '\\N')
}

export function titleAss(visual: TitleVisual, canvas: AssemblyCanvas): string {
  const layout = layoutTitle(visual, canvas)
  if (!layout.fits) throw new Error('字幕卡文字过多，请分成多张卡片')
  const size = layout.size
  const mainY = (canvas.height - layout.height + layout.mainHeight) / 2
  const main = `{\\pos(${canvas.width / 2},${mainY})}${escapeAssText(layout.text)}`
  const subtitle = layout.subtitle ? `\nDialogue: 1,0:00:00.00,24:00:00.00,Default,,0,0,0,,{\\fs${layout.subtitleSize}\\pos(${canvas.width / 2},${(canvas.height + layout.height) / 2 - (layout.height - layout.mainHeight - size * 0.4) / 2})}${escapeAssText(layout.subtitle)}` : ''
  // 很长的卡片仍由编辑器校验；导出使用和预览相同的固定画布百分比与留白。
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${canvas.width}\nPlayResY: ${canvas.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${titleFonts[visual.font].family},${size},${assColor(visual.foreground)},${assColor(visual.foreground)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,${Math.round(canvas.width * 0.12)},${Math.round(canvas.width * 0.12)},0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,24:00:00.00,Default,,0,0,0,,${main}${subtitle}\n`
}

export function subtitleFilter(path: string, fontDirectory?: string): string {
  const escapePath = (value: string) => value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''")
  return `subtitles=filename='${escapePath(path)}'${fontDirectory ? `:fontsdir='${escapePath(fontDirectory)}'` : ''}`
}

// 生成源适配和时间轴编排分离，新增生成型画面只扩展这里与对应预览组件。
export async function prepareGeneratedVisual(visual: GeneratedVisual, canvas: AssemblyCanvas, fps: number, directory: string, index: number, fontDirectory: string) {
  const renderers = {
    title: async () => {
      try { await access(join(fontDirectory, titleFonts[visual.font].file)) }
      catch { throw new Error(`字幕卡所需本地字体不可用：${titleFonts[visual.font].label}`) }
      const path = join(directory, `title-${index}.ass`)
      await writeFile(path, titleAss(visual, canvas), 'utf8')
      if (visual.surface && visual.surface !== 'plain') {
        const raster = join(directory, `title-${index}.png`)
        await writeAssemblyRaster(raster, { kind: 'surface', width: canvas.width, height: canvas.height, background: visual.background, surface: visual.surface })
        return { input: ['-loop', '1', '-framerate', String(fps), '-i', raster], filter: subtitleFilter(path, fontDirectory) }
      }
      return { input: ['-f', 'lavfi', '-i', `color=c=${visual.background}:s=${canvas.width}x${canvas.height}:r=${fps}`], filter: subtitleFilter(path, fontDirectory) }
    }
  }
  return renderers[visual.kind]()
}
