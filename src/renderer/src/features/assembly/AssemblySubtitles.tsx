import { useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faFileImport, faFileExport, faScissors, faLink, faClosedCaptioning } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyCaption, AssemblyVersion } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { defaultCaptionStyle, totalDuration } from '../../../../shared/assembly-timing'
import { useAssemblySubtitles } from './use-assembly-subtitles'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { titleFonts } from '../../../../shared/assembly-visual'

export function AssemblySubtitles({ version, position, disabled, selected, onSelect, onChange, onNotice }: {
  version: AssemblyVersion; position: number; disabled: boolean; selected: string | null; onSelect: (id: string) => void
  onChange: (version: AssemblyVersion) => void; onNotice: (message: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const subtitles = useAssemblySubtitles(version, onChange, onNotice)
  const captions = [...(version.captions ?? [])].sort((a, b) => a.start - b.start)
  const current = captions.find((caption) => caption.id === selected) ?? captions.find((caption) => position >= caption.start && position < caption.end) ?? captions[0]
  const currentIndex = captions.findIndex((caption) => caption.id === current?.id)
  const activeEditor = useRef<HTMLElement>(null)
  const activeRow = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // 只在主动选择改变时定位，不随播放时钟抢走文字输入焦点。
    const body = activeEditor.current?.closest('.assembly-inspector-body')
    if (body) body.scrollTop = 0
    const row = activeRow.current
    if (row?.parentElement) row.parentElement.scrollTop = Math.max(0, row.offsetTop - row.parentElement.offsetTop - row.parentElement.clientHeight / 2)
  }, [selected])
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
    {current && <section ref={activeEditor} className="assembly-caption-current" aria-label="当前字幕编辑">
      <div className="assembly-pane-heading"><strong>字幕 {currentIndex + 1} / {captions.length}</strong><Button variant="outline" size="small" onClick={() => onSelect(current.id)}>定位画面</Button></div>
      <fieldset className="assembly-form" disabled={disabled || subtitles.reading}>
        <label>字幕内容<textarea rows={3} maxLength={2000} value={current.text} onFocus={() => { if (selected !== current.id) onSelect(current.id) }} onChange={(event) => update(current.id, { text: event.target.value })} /></label>
        <div className="assembly-field-pair"><label>开始 / 秒<Input type="number" min={0} step={0.01} value={current.start} onChange={(event) => { const start = event.target.valueAsNumber; if (start >= 0 && start < current.end) update(current.id, { start }) }} /></label>
          <label>结束 / 秒<Input type="number" min={current.start} step={0.01} value={current.end} onChange={(event) => { const end = event.target.valueAsNumber; if (end > current.start && end <= 86400) update(current.id, { end }) }} /></label></div>
        <span className="muted">时长 {(current.end - current.start).toFixed(2)} 秒 · 修改实时预览</span>
        <div className="button-row"><Button variant="outline" size="small" disabled={position <= current.start || position >= current.end || captions.length >= 10000} onClick={() => onChange({ ...version, captions: captions.flatMap((item) => item.id === current.id ? [{ ...item, end: position }, { ...item, id: crypto.randomUUID(), start: position }] : [item]) })}><FontAwesomeIcon icon={faScissors} />拆分</Button>
          <Button variant="outline" size="small" disabled={!captions[currentIndex + 1] || current.text.length + (captions[currentIndex + 1]?.text.length ?? 0) + 1 > 2000} onClick={() => { const next = captions[currentIndex + 1]; if (next) onChange({ ...version, captions: captions.filter((item) => item.id !== next.id).map((item) => item.id === current.id ? { ...item, end: Math.max(item.end, next.end), text: `${item.text}\n${next.text}` } : item) }) }}><FontAwesomeIcon icon={faLink} />合并下一条</Button>
          <Button variant="ghost" size="icon" title="删除当前字幕" aria-label="删除当前字幕" onClick={() => { onChange({ ...version, captions: captions.filter((item) => item.id !== current.id) }); const next = captions[currentIndex + 1] ?? captions[currentIndex - 1]; if (next) onSelect(next.id) }}><FontAwesomeIcon icon={faTrash} /></Button></div>
      </fieldset>
      {(captions.some((item) => item.id !== current.id && item.start < current.end && item.end > current.start) || current.end > totalDuration(version) || current.text.split('\n').some((line) => line.length > 28)) && <p className="text-warning">{current.end > totalDuration(version) ? '超出成片范围' : captions.some((item) => item.id !== current.id && item.start < current.end && item.end > current.start) ? '与其他字幕重叠' : '单行文字较长'}</p>}
    </section>}
    {!current && <p className="assembly-subtle-empty">暂无字幕，可在播放头新增或导入 SRT</p>}
    <div className="assembly-caption-navigation"><Button variant="outline" size="small" disabled={currentIndex <= 0} onClick={() => { const item = captions[currentIndex - 1]; if (item) onSelect(item.id) }}>上一条</Button><span className="muted">{captions.length} 条字幕</span><Button variant="outline" size="small" disabled={currentIndex < 0 || currentIndex >= captions.length - 1} onClick={() => { const item = captions[currentIndex + 1]; if (item) onSelect(item.id) }}>下一条</Button></div>
    <div className="assembly-caption-list" aria-label="字幕列表">{captions.map((caption, index) => <button type="button" key={caption.id} ref={current?.id === caption.id ? activeRow : undefined} aria-pressed={current?.id === caption.id} onClick={() => onSelect(caption.id)} title={caption.text}><span>{index + 1}</span><strong>{caption.text || '空字幕'}</strong><small>{caption.start.toFixed(2)}–{caption.end.toFixed(2)} 秒</small></button>)}</div>
    <details className="assembly-caption-settings"><summary>全局字幕样式与导入工具</summary>
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
    </details>
  </div>
}
