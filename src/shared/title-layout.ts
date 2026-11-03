import type { AssemblyCanvas, TitleVisual } from './contracts/assembly'

// 预览与 ASS 共用分行；中文按全角、拉丁字符按近似半角计宽，边缘另留安全余量。
export function layoutTitle(visual: TitleVisual, canvas: Pick<AssemblyCanvas, 'width' | 'height'>) {
  const wrap = (size: number, text = visual.text) => text.replace(/\r\n?/g, '\n').split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let line = '', width = 0
    for (const character of Array.from(paragraph)) {
      const advance = size * (/^[\u0020-\u007e]$/.test(character) ? 0.65 : 1)
      if (line && width + advance > canvas.width * 0.72) { lines.push(line); line = ''; width = 0 }
      line += character; width += advance
    }
    lines.push(line)
    return lines
  })
  let size = Math.min(canvas.height * visual.size / 100, canvas.width * 0.72)
  let lines = wrap(size)
  const minimum = Math.min(canvas.height * 0.025, canvas.width * 0.72)
  const blockHeight = () => lines.length * size * 1.4 + (visual.subtitle ? wrap(size * 0.4, visual.subtitle).length * size * 0.56 + size * 0.4 : 0)
  while (blockHeight() > canvas.height * 0.76 && size > minimum) {
    size = Math.max(minimum, size - 1); lines = wrap(size)
  }
  return { text: lines.join('\n'), size, subtitle: visual.subtitle ? wrap(size * 0.4, visual.subtitle).join('\n') : '', subtitleSize: size * 0.4,
    mainHeight: lines.length * size * 1.4, height: blockHeight(), fits: blockHeight() <= canvas.height * 0.76 }
}
