import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import type { ClipColor } from '@contracts/assembly'
import { neutralClipColor, hasClipColor } from '../../../../shared/clip-color'
import { Button } from '@/components/ui/button'

const controls: { key: keyof ClipColor; title: string; min: number; max: number }[] = [
  { key: 'temperature', title: '冷暖', min: -30, max: 30 },
  { key: 'tint', title: '红绿偏色', min: -30, max: 30 },
  { key: 'brightness', title: '亮度', min: -20, max: 20 },
  { key: 'contrast', title: '对比度', min: 50, max: 150 },
  { key: 'saturation', title: '饱和度', min: 0, max: 200 }
]

export function ClipColorControls({ color, onChange }: { color?: ClipColor | undefined; onChange: (color: ClipColor) => void }) {
  const current = color ?? neutralClipColor
  return <div className="assembly-form">
    <div className="assembly-pane-heading"><h3>片段调色</h3><Button type="button" variant="ghost" size="icon" disabled={!hasClipColor(color)} title="重置片段调色" aria-label="重置片段调色" onClick={() => onChange({ ...neutralClipColor })}><FontAwesomeIcon icon={faRotateLeft} /></Button></div>
    {controls.map(({ key, title, min, max }) => <label key={key}>{title} · {Math.round(current[key] * 100)}
      <input aria-label={`片段${title}`} type="range" min={min} max={max} step={1} value={Math.round(current[key] * 100)} onChange={(event) => onChange({ ...current, [key]: Number(event.target.value) / 100 })} />
    </label>)}
  </div>
}
