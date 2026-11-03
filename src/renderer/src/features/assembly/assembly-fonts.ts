import type { TitleVisual } from '../../../../shared/contracts/assembly'
import { titleFonts } from '../../../../shared/assembly-visual'

interface AssemblyFontSet {
  load(font: string): Promise<readonly unknown[]>
}

export async function loadAssemblyFonts(fonts: readonly TitleVisual['font'][], fontSet: AssemblyFontSet): Promise<void> {
  const loaded = await Promise.all([...new Set(fonts)].map((font) => fontSet.load(`16px "${titleFonts[font].family}"`)))
  if (loaded.some((faces) => !faces.length)) throw new Error('字幕卡本地字体未载入')
}
