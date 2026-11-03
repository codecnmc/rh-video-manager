import type { AssemblyCanvas, GeneratedVisual } from '@contracts/assembly'
import { layoutTitle } from '../../../../shared/title-layout'
import { titleFonts } from '../../../../shared/assembly-visual'
import { AssemblyRaster } from './AssemblyRaster'

export function AssemblyGeneratedVisual({ visual, canvas, height, opacity, layer }: {
  visual: GeneratedVisual; canvas: AssemblyCanvas; height: number; opacity: number; layer: number
}) {
  const layout = layoutTitle(visual, canvas)
  const renderers = {
    title: <div className="assembly-title-visual" style={{ background: visual.background, color: visual.foreground,
      fontFamily: titleFonts[visual.font].family, fontSize: layout.size * height / canvas.height, opacity, zIndex: layer }}>
      {(visual.surface ?? 'plain') !== 'plain' && <AssemblyRaster request={{ kind: 'surface', width: canvas.width, height: canvas.height, background: visual.background, surface: visual.surface ?? 'plain' }} />}
      <div className="assembly-title-content"><div>{layout.text}</div>{layout.subtitle && <div style={{ fontSize: '40%', marginTop: '1em' }}>{layout.subtitle}</div>}</div>
    </div>
  }
  return renderers[visual.kind]
}
