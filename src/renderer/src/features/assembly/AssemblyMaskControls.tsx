import type { FrameMask } from '../../../../shared/contracts/assembly-effects'
import { defaultFilmMask } from '../../../../shared/assembly-surfaces'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'

export function AssemblyMaskControls({ mask, inherited = false, onChange }: {
  mask: FrameMask | null | undefined; inherited?: boolean; onChange: (mask: FrameMask | null | undefined) => void
}) {
  return <><label>画面遮罩<SelectField value={mask === undefined ? 'inherit' : mask === null ? 'none' : mask.kind} onChange={(event) => {
    const value = event.target.value
    onChange(value === 'inherit' ? undefined : value === 'none' ? null : { ...(mask ?? defaultFilmMask), kind: value === 'ellipse' ? 'ellipse' : 'rounded' })
  }}>{inherited && <SelectOption value="inherit">沿用全片</SelectOption>}{!inherited && <SelectOption value="inherit">关闭</SelectOption>}{inherited && <SelectOption value="none">此片段关闭</SelectOption>}<SelectOption value="rounded">圆角胶片窗口</SelectOption><SelectOption value="ellipse">椭圆暗边</SelectOption></SelectField></label>
    {mask && <div className="assembly-field-pair">{([
      ['inset', '边距 / 短边 %', 20, 0.5], ['radius', '圆角 / 短边 %', 40, 0.5], ['feather', '柔边 / 短边 %', 10, 0.25], ['strength', '黑边强度', 1, 0.05]
    ] as const).map(([key, label, max, step]) => <label key={key}>{label}<Input type="number" min={0} max={max} step={step} value={mask[key]} disabled={key === 'radius' && mask.kind === 'ellipse'} onChange={(event) => {
      const value = event.target.valueAsNumber
      if (Number.isFinite(value) && value >= 0 && value <= max) onChange({ ...mask, [key]: value })
    }} /></label>)}</div>}</>
}
