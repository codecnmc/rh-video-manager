import type { AssemblyVersion } from '@contracts/assembly'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { assemblyCanvasSchema } from '@contracts/assembly'
import { defaultAssemblyCanvas } from '../../../../shared/assembly-visual'
import { AssemblyMaskControls } from './AssemblyMaskControls'

export function AssemblyCanvasControls({ version, disabled, onChange }: {
  version: AssemblyVersion; disabled: boolean; onChange: (version: AssemblyVersion) => void
}) {
  const canvas = version.canvas ?? defaultAssemblyCanvas
  return <fieldset className="assembly-form" disabled={disabled}>
    <AssemblyMaskControls mask={version.frameMask} onChange={(frameMask) => { const next = { ...version }; if (frameMask) next.frameMask = frameMask; else delete next.frameMask; onChange(next) }} />
    <label>输出画布<SelectField aria-label="输出画布" value={version.canvas ? `${canvas.width}x${canvas.height}` : 'source'} onChange={(event) => {
      if (event.target.value === 'source') { const next = { ...version }; delete next.canvas; onChange(next); return }
      if (event.target.value === 'custom') { onChange({ ...version, canvas }); return }
      const [width, height] = event.target.value.split('x').map(Number)
      const parsed = assemblyCanvasSchema.safeParse({ ...canvas, width, height })
      if (parsed.success) onChange({ ...version, canvas: parsed.data })
    }}><SelectOption value="source">沿用首个视频尺寸</SelectOption>{['1280x720', '1920x1080', '720x1280', '1080x1920'].map((size) => <SelectOption key={size} value={size}>{size}</SelectOption>)}<SelectOption value="custom">自定义</SelectOption>{version.canvas && !['1280x720', '1920x1080', '720x1280', '1080x1920'].includes(`${canvas.width}x${canvas.height}`) && <SelectOption value={`${canvas.width}x${canvas.height}`}>{canvas.width}x{canvas.height}</SelectOption>}</SelectField></label>
    {version.canvas && <><div className="assembly-field-pair">{(['width', 'height'] as const).map((axis) => <label key={axis}>{axis === 'width' ? '宽 / px' : '高 / px'}<Input type="number" min={128} max={4096} step={2} value={canvas[axis]} onChange={(event) => {
      const parsed = assemblyCanvasSchema.safeParse({ ...canvas, [axis]: event.target.valueAsNumber })
      if (parsed.success) onChange({ ...version, canvas: parsed.data })
    }} /></label>)}</div><label>画面适配<SelectField value={canvas.fit} onChange={(event) => onChange({ ...version, canvas: { ...canvas, fit: event.target.value === 'cover' ? 'cover' : 'contain' } })}><SelectOption value="contain">完整显示 · 留边</SelectOption><SelectOption value="cover">填满画布 · 居中裁切</SelectOption></SelectField></label></>}
  </fieldset>
}
