import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { titleVisualSchema, type AssemblyClip, type AssemblyVersion, type TitleVisual } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Dialog } from '@/components/ui/dialog'
import { defaultTitleVisual, titleFonts } from '../../../../shared/assembly-visual'
import { resizeGeneratedClip } from '../../../../shared/assembly-insert'
import { titlePresets } from '../../../../shared/assembly-surfaces'
import { titleSurfaceSchema } from '../../../../shared/contracts/assembly-effects'
import { applyAssemblyEdits } from '../../../../shared/assembly-edit'
import { timelineClips } from '../../../../shared/assembly-timing'

function TitleStyle({ visual, onChange }: { visual: TitleVisual; onChange: (visual: TitleVisual) => void }) {
  return <><label>样式预设<SelectField value="custom" onChange={(event) => { const preset = titlePresets[event.target.value]; if (preset) onChange({ ...preset.visual, text: visual.text, subtitle: visual.subtitle ?? '' }) }}><SelectOption value="custom">自定义</SelectOption>{Object.entries(titlePresets).map(([id, preset]) => <SelectOption key={id} value={id}>{preset.label}</SelectOption>)}</SelectField></label>
    <label>背景材质<SelectField value={visual.surface ?? 'plain'} onChange={(event) => onChange({ ...visual, surface: titleSurfaceSchema.parse(event.target.value) })}><SelectOption value="plain">纯色</SelectOption><SelectOption value="paper">旧纸</SelectOption><SelectOption value="fabric">暗纹织物</SelectOption></SelectField></label>
    <label>副标题<Input maxLength={300} value={visual.subtitle ?? ''} onChange={(event) => onChange({ ...visual, subtitle: event.target.value })} /></label>
    <label>字体<SelectField value={visual.font} onChange={(event) => onChange({ ...visual, font: event.target.value === 'song' ? 'song' : 'sans' })}>{Object.entries(titleFonts).map(([id, font]) => <SelectOption key={id} value={id}>{font.label}</SelectOption>)}</SelectField></label>
    <label>字号 / 画布高度 %<Input type="number" min={2} max={15} step={0.1} value={visual.size} onChange={(event) => { const size = event.target.valueAsNumber; if (size >= 2 && size <= 15) onChange({ ...visual, size }) }} /></label>
    <div className="assembly-field-pair"><label>文字颜色<input type="color" value={visual.foreground} onChange={(event) => onChange({ ...visual, foreground: event.target.value })} /></label><label>背景颜色<input type="color" value={visual.background} onChange={(event) => onChange({ ...visual, background: event.target.value })} /></label></div></>
}

export function AssemblyTitleInspector({ version, clip, onChange, onNotice }: {
  version: AssemblyVersion; clip: AssemblyClip; onChange: (version: AssemblyVersion) => void; onNotice: (message: string) => void
}) {
  const [duration, setDuration] = useState(String(clip.outPoint - clip.inPoint))
  if (!clip.visual) return null
  const visual = clip.visual
  const update = (next: TitleVisual) => onChange({ ...version, clips: version.clips.map((item) => item.id === clip.id ? { ...item, visual: next } : item) })
  return <><label>卡片文字<textarea rows={6} maxLength={2000} value={visual.text} onChange={(event) => update({ ...visual, text: event.target.value })} /></label>
    <div className="assembly-field-pair"><label>时长 / 秒<Input type="number" min={0.1} max={86400} step={0.1} value={duration} onChange={(event) => setDuration(event.target.value)} /></label><Button variant="outline" onClick={() => {
      try { onChange(resizeGeneratedClip(version, clip.id, Number(duration), crypto.randomUUID)) }
      catch (error) { onNotice(error instanceof Error ? error.message : '字幕卡时长调整失败') }
    }}>联动应用</Button></div>
    <TitleStyle visual={visual} onChange={update} /></>
}

const insertSchema = z.object({ text: z.string().max(2000), duration: z.number().finite().min(0.1).max(86400) })
type InsertValues = z.infer<typeof insertSchema>

export function AssemblyInsertTitle({ version, position, onChange, onClose, onSelect }: {
  version: AssemblyVersion; position: number; onChange: (version: AssemblyVersion) => void; onClose: () => void; onSelect: (id: string) => void
}) {
  const form = useForm<InsertValues>({ resolver: zodResolver(insertSchema), defaultValues: { text: '', duration: 2 } })
  const [visual, setVisual] = useState(defaultTitleVisual)
  const [error, setError] = useState('')
  const [replaceGap, setReplaceGap] = useState(false)
  const gap = timelineClips(version).find((entry) => (entry.clip.gapBefore ?? 0) > 0 && position >= entry.start - entry.clip.gapBefore! && position < entry.start)
  return <Dialog title="插入字幕卡" onClose={onClose}><form className="assembly-form" onSubmit={form.handleSubmit((values) => {
    try {
      const parsed = titleVisualSchema.parse({ ...visual, text: values.text })
      const gapStart = gap ? gap.start - gap.clip.gapBefore! : 0
      const next = applyAssemblyEdits(version, replaceGap && gap ? [{ kind: 'replace-gap-with-title', beforeClipId: gap.clip.id, visual: parsed,
        removeCaptionIds: (version.captions ?? []).filter((caption) => caption.start >= gapStart && caption.end <= gap.start).map((caption) => caption.id) }]
        : [{ kind: 'insert-title', position, duration: values.duration, visual: parsed }], crypto.randomUUID)
      const inserted = next.clips.find((clip) => !version.clips.some((item) => item.id === clip.id) && clip.visual)
      onChange(next); if (inserted) onSelect(inserted.id); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '字幕卡插入失败') }
  })}>
    <label>插入点 / 秒<Input readOnly value={position.toFixed(3)} /></label>
    {gap && <label className="assembly-checkbox"><input type="checkbox" checked={replaceGap} onChange={(event) => setReplaceGap(event.target.checked)} />等时替换此处黑场及其内部字幕</label>}
    <label>卡片文字<textarea autoFocus rows={6} maxLength={2000} {...form.register('text')} /></label>
    <label>时长 / 秒{replaceGap && gap ? <Input readOnly value={gap.clip.gapBefore} /> : <Input type="number" min={0.1} max={86400} step={0.1} {...form.register('duration', { valueAsNumber: true })} />}</label>
    <TitleStyle visual={visual} onChange={setVisual} />
    {(error || form.formState.errors.duration) && <p role="alert" className="field-error">{error || form.formState.errors.duration?.message}</p>}
    <Button type="submit">{replaceGap && gap ? '等时替换黑场' : '插入并联动后续内容'}</Button>
  </form></Dialog>
}
