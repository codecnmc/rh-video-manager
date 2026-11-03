import type { EditorMode } from '@contracts/settings'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MarkdownPreview } from './MarkdownPreview'

export function MarkdownModeControl({ mode, onChange }: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  return <ToggleGroup className="markdown-mode-control" type="single" value={mode} onValueChange={(value) => { if (value === 'edit' || value === 'preview' || value === 'split') onChange(value) }} aria-label="Markdown 显示模式">
    <ToggleGroupItem value="edit">编辑</ToggleGroupItem><ToggleGroupItem value="preview">预览</ToggleGroupItem><ToggleGroupItem value="split">分屏</ToggleGroupItem>
  </ToggleGroup>
}

export function MarkdownEditor({ value, onChange, mode, fontSize, disabled = false }: {
  value: string; onChange: (value: string) => void; mode: EditorMode; fontSize: number; disabled?: boolean
}) {
  return <div className={`markdown-surface markdown-${mode}`} style={{ fontSize }}>
    {mode !== 'preview' && <section className="markdown-pane markdown-source-pane" aria-label="Markdown 编辑区"><div className="markdown-pane-heading">Markdown</div><Textarea aria-label="Markdown 正文" className="markdown-source" value={value} maxLength={200000} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></section>}
    {mode !== 'edit' && <section className="markdown-pane markdown-preview-pane" aria-label="预览区"><div className="markdown-pane-heading">预览</div><MarkdownPreview markdown={value} /></section>}
  </div>
}
