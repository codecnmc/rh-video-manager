import { useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faFileImport, faFileExport, faScissors, faLink, faClosedCaptioning } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyCaption, AssemblyVersion } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { defaultCaptionStyle, totalDuration } from '../../../../shared/assembly-timing'
import { useAssemblySubtitles } from './use-assembly-subtitles'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { titleFonts } from '../../../../shared/assembly-visual'

export function AssemblySubtitles({ version, position, disabled, selected, onSelect, onChange, onSeek, onNotice }: {
  version: AssemblyVersion; position: number; disabled: boolean; selected: string | null; onSelect: (id: string) => void
  onChange: (version: AssemblyVersion) => void; onSeek: (time: number) => void; onNotice: (message: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const subtitles = useAssemblySubtitles(version, onChange, onNotice)
  const captions = [...(version.captions ?? [])].sort((a, b) => a.start - b.start)
  const style = version.captionStyle ?? defaultCaptionStyle
  function update(id: string, patch: Partial<AssemblyCaption>) {
    onChange({ ...version, captions: captions.map((caption) => caption.id === id ? { ...caption, ...patch } : caption) })
  }
  return <div className="assembly-subtitles"><div className="assembly-pane-heading"><h3>字幕</h3><div className="button-row">
    <Button variant="ghost" size="icon" title="导入 SRT" aria-label="导入 SRT" disabled={disabled || subtitles.reading} onClick={() => input.current?.click()}><FontAwesomeIcon icon={faFileImport} /></Button>
    <Button variant="ghost" size="icon" title="导出 SRT" aria-label="导出 SRT" disabled={disabled || !captions.length} onClick={subtitles.exportSrt}><FontAwesomeIcon icon={faFileExport} /></Button>
    <Button variant="ghost" size="icon" title="在播放头新增字幕" aria-label="新增字幕" disabled={disabled || captions.length >= 10000 || position >= totalDuration(version)} onClick={() => {
      const caption = { id: crypto.randomUUID(), start: position, end: Math.min(totalDuration(version), position + 2), text: '新字幕' }
      onChange({ ...version, captions: [...captions, caption] }); onSelect(caption.id)
    }}><FontAwesomeIcon icon={faPlus} /></Button></div></div>
    <input ref={input} type="file" accept=".srt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void subtitles.importSrt(file); event.target.value = '' }} />
    <Button variant="outline" disabled={disabled || subtitles.reading || !version.clips.length} onClick={subtitles.previewPrompts}><FontAwesomeIcon icon={faClosedCaptioning} />从提示词生成字幕</Button>
    {subtitles.draft && <section aria-label="对白字幕预览">
      <h3>待追加对白 · {subtitles.draft.captions.length} 条</h3>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>{subtitles.draft.captions.map((caption) => <p key={caption.id}>{caption.start.toFixed(2)}–{caption.end.toFixed(2)} 秒 · {caption.text}</p>)}</div>
      <div className="button-row"><Button disabled={disabled || subtitles.reading} onClick={subtitles.appendDraft}>确认追加</Button><Button variant="ghost" onClick={subtitles.cancelDraft}>取消</Button></div>
    </section>}
    <fieldset className="assembly-form" disabled={disabled || subtitles.reading}>
      <label className="assembly-checkbox"><input type="checkbox" checked={version.burnCaptions ?? true} onChange={(event) => onChange({ ...version, burnCaptions: event.target.checked })} />导出时烧录字幕</label>
      <label>字幕预设<SelectField value="custom" onChange={(event) => {
        if (event.target.value === 'silent') onChange({ ...version, captionStyle: { size: 9, bottom: 8, outline: 0, color: '#f2f2ec', font: 'song', alignment: 'center' } })
        if (event.target.value === 'dialogue') onChange({ ...version, captionStyle: { ...defaultCaptionStyle, font: 'sans', alignment: 'bottom' } })
      }}><SelectOption value="custom">自定义</SelectOption><SelectOption value="silent">默片 · 大字宋体</SelectOption><SelectOption value="dialogue">对白 · 底部字幕</SelectOption></SelectField></label>
      <div className="assembly-field-pair"><label>字体<SelectField value={style.font ?? 'sans'} onChange={(event) => onChange({ ...version, captionStyle: { ...style, font: event.target.value === 'song' ? 'song' : 'sans' } })}>{Object.entries(titleFonts).map(([id, font]) => <SelectOption key={id} value={id}>{font.label}</SelectOption>)}</SelectField></label>
        <label>对齐<SelectField value={style.alignment ?? 'bottom'} onChange={(event) => onChange({ ...version, captionStyle: { ...style, alignment: event.target.value === 'center' ? 'center' : 'bottom' } })}><SelectOption value="bottom">底部</SelectOption><SelectOption value="center">画面居中</SelectOption></SelectField></label></div>
      <div className="assembly-field-pair"><label>字号 / 画面高度 %<Input type="number" min={2} max={15} step={0.1} value={style.size} onChange={(event) => { const size = event.target.valueAsNumber; if (size >= 2 && size <= 15) onChange({ ...version, captionStyle: { ...style, size } }) }} /></label>
        <label>底部安全区 / %<Input type="number" min={5} max={50} disabled={style.alignment === 'center'} value={style.bottom} onChange={(event) => { const bottom = event.target.valueAsNumber; if (bottom >= 5 && bottom <= 50) onChange({ ...version, captionStyle: { ...style, bottom } }) }} /></label></div>
      <div className="assembly-field-pair"><label>文字颜色<input type="color" value={style.color} onChange={(event) => onChange({ ...version, captionStyle: { ...style, color: event.target.value } })} /></label>
        <label>描边 / 画面高度 %<Input type="number" min={0} max={0.5} step={0.05} value={style.outline} onChange={(event) => { const outline = event.target.valueAsNumber; if (outline >= 0 && outline <= 0.5) onChange({ ...version, captionStyle: { ...style, outline } }) }} /></label></div>
    </fieldset>
    {captions.map((caption, index) => <section key={caption.id} className={`assembly-caption-item${selected === caption.id ? ' selected' : ''}`}>
      <div className="assembly-pane-heading"><Button variant="ghost" size="small" onClick={() => { onSelect(caption.id); onSeek(caption.start) }}>{index + 1}</Button><div className="button-row">
        <Button variant="ghost" size="icon" title="播放头处分割字幕" aria-label="分割字幕" disabled={disabled || position <= caption.start || position >= caption.end} onClick={() => onChange({ ...version, captions: captions.flatMap((item) => item.id === caption.id ? [{ ...item, end: position }, { ...item, id: crypto.randomUUID(), start: position }] : [item]) })}><FontAwesomeIcon icon={faScissors} /></Button>
        <Button variant="ghost" size="icon" title="与下一条合并" aria-label="合并字幕" disabled={disabled || !captions[index + 1]} onClick={() => { const next = captions[index + 1]!; onChange({ ...version, captions: captions.filter((item) => item.id !== next.id).map((item) => item.id === caption.id ? { ...item, end: Math.max(item.end, next.end), text: `${item.text}\n${next.text}` } : item) }) }}><FontAwesomeIcon icon={faLink} /></Button>
        <Button variant="ghost" size="icon" title="删除字幕" aria-label="删除字幕" disabled={disabled} onClick={() => onChange({ ...version, captions: captions.filter((item) => item.id !== caption.id) })}><FontAwesomeIcon icon={faTrash} /></Button></div></div>
      <fieldset className="assembly-form" disabled={disabled}><div className="assembly-field-pair"><label>开始 / 秒<Input type="number" min={0} step={0.01} value={caption.start} onChange={(event) => { const start = event.target.valueAsNumber; if (start >= 0 && start < caption.end) update(caption.id, { start }) }} /></label>
        <label>结束 / 秒<Input type="number" min={caption.start} step={0.01} value={caption.end} onChange={(event) => { const end = event.target.valueAsNumber; if (end > caption.start && end <= 86400) update(caption.id, { end }) }} /></label></div>
        <label>文字<textarea rows={2} maxLength={2000} value={caption.text} onFocus={() => onSelect(caption.id)} onChange={(event) => update(caption.id, { text: event.target.value })} /></label></fieldset>
      {(captions.some((item) => item.id !== caption.id && item.start < caption.end && item.end > caption.start) || caption.end > totalDuration(version) || caption.text.split('\n').some((line) => line.length > 28)) && <p className="text-warning">{caption.end > totalDuration(version) ? '超出成片范围' : captions.some((item) => item.id !== caption.id && item.start < caption.end && item.end > caption.start) ? '与其他字幕重叠' : '单行文字较长'}</p>}
    </section>)}
  </div>
}
