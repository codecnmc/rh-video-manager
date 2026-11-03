import type { AssemblyCanvas } from '../../../../shared/contracts/assembly'
import type { AssemblyExportOptions } from '../../../../shared/contracts/assembly-export'

export function exportCanvas(canvas: AssemblyCanvas, resolution: AssemblyExportOptions['resolution']): AssemblyCanvas {
  if (resolution === 'project') return canvas
  const shortSide = Number(resolution.slice(0, -1))
  const scale = shortSide / Math.min(canvas.width, canvas.height)
  const width = Math.round(canvas.width * scale / 2) * 2
  const height = Math.round(canvas.height * scale / 2) * 2
  if (width > 4096 || height > 4096 || width < 128 || height < 128) throw new Error('此画幅比例在所选分辨率下超出128–4096像素范围，请选择其他分辨率')
  return { ...canvas, width, height }
}
