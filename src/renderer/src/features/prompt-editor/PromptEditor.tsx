import { SelectOption } from '@/components/ui/select-field'
import { SelectField } from '@/components/ui/select-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useEffect, useState } from 'react'
import { Node, type JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotateLeft, faRotateRight, faBold, faItalic, faExpand, faCompress, faUser, faFilm, faClock, faMicrophone, faComment, faScissors, faArrowsLeftRight, faXmark, faFolderOpen, faPaperclip, faListCheck, faImages } from '@fortawesome/free-solid-svg-icons'
import { h3Sections } from '@contracts/h3'
import { validPromptDocument } from '@contracts/prompt-document'
import type { ReferenceKind, DraftReference } from '@contracts/references'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { AssetImagePreview } from '@/features/assets'
import { H3Syntax, ensureH3SyntaxPlugin, h3SyntaxPluginKey } from './h3-syntax'

const ReferenceToken = Node.create({
  name: 'promptReference', inline: true, group: 'inline', atom: true,
  addAttributes() { return { label: { default: '' } } },
  parseHTML() { return [{ tag: 'span[data-prompt-reference]', getAttrs: (element) => ({ label: element.getAttribute('data-label') ?? '' }) }] },
  renderHTML({ node }) { return ['span', { class: 'reference-token', 'data-prompt-reference': '', 'data-label': String(node.attrs.label) }, String(node.attrs.label)] },
  renderText({ node }) { return String(node.attrs.label) }
})
const extensions = [StarterKit.configure({ link: false, underline: false, codeBlock: false }), ReferenceToken, H3Syntax,
  Placeholder.configure({ placeholder: '描述视频内容、人物动作、镜头、对白、声音……' })]

function initialContent(document: string, text: string): JSONContent {
  if (document && validPromptDocument(document)) return JSON.parse(document) as JSONContent
  return { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }
}

interface PromptEditorProps {
  text: string; document: string; duration: number; disabled: boolean; references: DraftReference[]; busy: boolean
  onChange: (text: string, document: string) => void
  onImport: (kind: ReferenceKind) => void
  onDropFiles: (files: File[]) => void
  onPasteImages: (files: File[]) => void
  onRemove: (reference: DraftReference) => void
  onReplace?: (reference: DraftReference) => void
  onReveal: (id: string) => void
  onCheckStructure: () => void
  onOpenVoices: () => void
  onOpenLibrary: () => void
  referenceStatus: 'loading' | 'ready' | 'error'
}

export function PromptEditor({ text, document, duration, disabled, references, busy, onChange, onImport, onPasteImages, onDropFiles, onRemove, onReplace, onReveal, onCheckStructure, onOpenLibrary, onOpenVoices, referenceStatus }: PromptEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [tool, setTool] = useState<'time' | 'dialogue' | null>(null)
  const [time, setTime] = useState('')
  const [speaker, setSpeaker] = useState(1)
  const [language, setLanguage] = useState('Chinese')
  const [speech, setSpeech] = useState('')
  const editor = useEditor({ extensions, content: initialContent(document, text), editable: !disabled,
    immediatelyRender: false, shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'prompt-prose', role: 'textbox', 'aria-label': '全能参考提示词', 'aria-multiline': 'true' },
      handleDrop: (view, event) => {
        const transfer = event.dataTransfer
        if (!transfer) return false
        const files = Array.from(transfer.files)
        const label = transfer.getData('application/x-workbench-reference')
        if (!files.length && !label) return false
        event.preventDefault()
        if (disabled || busy) return true
        if (files.length) { onDropFiles(files); return true }
        // 只插入当前草稿中已经绑定的标签，不能信任外部拖入的引用内容。
        if (references.some((reference) => reference.label === label)) {
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
          const token = view.state.schema.nodes.promptReference?.create({ label })
          if (token) view.dispatch(view.state.tr.insert(position, token))
        }
        return true
      },
      handlePaste: (view, event, slice) => {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        const files = Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'))
        if (!files.length) return false
        if (disabled) return true
        // 图文混贴保留原有文字和格式，图片只进入附件，不写入富文本文档。
        if (slice.content.textBetween(0, slice.content.size).trim()) view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        onPasteImages(files)
        return true
      }
    },
    onUpdate: ({ editor: current }) => onChange(current.getText({ blockSeparator: '\n' }), JSON.stringify(current.getJSON()))
  })
  useEffect(() => {
    if (editor && !editor.isDestroyed) ensureH3SyntaxPlugin(editor)
  }, [editor, h3SyntaxPluginKey])
  useEffect(() => { editor?.setEditable(!disabled, false) }, [disabled, editor])
  useEffect(() => {
    if (editor && (editor.getText({ blockSeparator: '\n' }) !== text || (document && JSON.stringify(editor.getJSON()) !== document))) {
      editor.commands.setContent(initialContent(document, text), { emitUpdate: false })
    }
  }, [editor, text, document])
  useEffect(() => {
    if (!expanded) return
    const escape = (event: KeyboardEvent) => {
      // 图片预览的 Escape 交给原生弹窗，避免同时收起底层编辑器。
      if (event.key === 'Escape' && !tool && !(event.target instanceof Element && event.target.closest('dialog[open]'))) setExpanded(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [expanded, tool])
  const insert = (value: string) => editor?.chain().focus().insertContent({ type: 'text', text: value }).run()
  const insertReference = (label: string) => editor?.chain().focus().insertContent([{ type: 'promptReference', attrs: { label } }, { type: 'text', text: ' ' }]).run()
  const next = (pattern: RegExp) => Math.max(0, ...[...text.matchAll(pattern)].map((match) => Number(match[1]))) + 1
  const counts = (kind: ReferenceKind) => references.filter((reference) => reference.kind === kind).length
  return <div className={`prompt-composer ${expanded ? 'composer-expanded' : ''}`}>
    {expanded && <Button variant="ghost" size="icon" className="prompt-composer-close" title="退出提示词全屏" aria-label="退出提示词全屏" onClick={() => setExpanded(false)}><FontAwesomeIcon icon={faXmark} /></Button>}
    <div className="prompt-editor-surface">
    <section className="prompt-references" aria-label="参考素材">
      <div className="prompt-reference-heading"><h3>参考素材</h3><div className="reference-add"><Button variant="ghost" size="small" disabled={disabled || busy || counts('audio') >= 3} onClick={onOpenVoices}>音色库</Button>
        <Button variant="ghost" size="small" disabled={disabled || busy} onClick={onOpenLibrary}><FontAwesomeIcon icon={faImages} />素材库</Button>
        <FontAwesomeIcon icon={faPaperclip} /><SelectField aria-label="添加参考素材" value="" disabled={disabled || busy} onChange={(event) => onImport(event.target.value as ReferenceKind)}>
          <SelectOption value="">添加素材</SelectOption><SelectOption value="image" disabled={counts('image') >= 9}>图片</SelectOption><SelectOption value="video" disabled={counts('video') >= 3}>视频</SelectOption><SelectOption value="audio" disabled={counts('audio') >= 3}>音频</SelectOption>
        </SelectField>
      </div></div>
      <div className="reference-counts"><span>图片 {referenceStatus === 'ready' ? counts('image') : '—'}/9</span><span>视频 {referenceStatus === 'ready' ? counts('video') : '—'}/3</span><span>音频 {referenceStatus === 'ready' ? counts('audio') : '—'}/3</span></div>
      {references.length > 0 ? <div className="prompt-reference-list">{references.map((reference) => <ContextMenu key={reference.id}>
        <ContextMenuTrigger asChild><div className="reference-item" tabIndex={0} role="group" aria-label={`${reference.label} ${reference.name}`} draggable={!disabled && !busy} onDragStart={(event) => {
          if (disabled || busy) { event.preventDefault(); return }
          event.dataTransfer.setData('application/x-workbench-reference', reference.label)
          event.dataTransfer.effectAllowed = 'copy'
        }} onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }))
        }}>
        {reference.kind === 'image' ? <AssetImagePreview assetId={reference.assetId} name={reference.name} label={reference.label} />
          : <div className="reference-media-type"><FontAwesomeIcon icon={reference.kind === 'video' ? faFilm : faMicrophone} /><span>{reference.kind === 'video' ? '视频参考' : '音频参考'}</span></div>}
        <div className="reference-label" title={`${reference.name} · 拖入提示词可插入引用；右键可替换、引用或解除关联`}><strong>{reference.label}</strong><span>{reference.name}</span></div>
        </div></ContextMenuTrigger>
        <ContextMenuContent>
          {onReplace && <ContextMenuItem disabled={disabled || busy} onSelect={() => onReplace(reference)}><FontAwesomeIcon icon={faArrowsLeftRight} />替换素材，保留 {reference.label}</ContextMenuItem>}
          <ContextMenuItem disabled={disabled} onSelect={() => { insertReference(reference.label) }}><FontAwesomeIcon icon={faPaperclip} />插入引用 {reference.label}</ContextMenuItem>
          <ContextMenuItem onSelect={() => onReveal(reference.id)}><FontAwesomeIcon icon={faFolderOpen} />在文件夹中显示</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={disabled || busy} onSelect={() => onRemove(reference)}><FontAwesomeIcon icon={faXmark} />解除素材关联</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>)}</div> : <div className="reference-empty" role="status">{referenceStatus === 'loading' ? '正在读取参考素材' : referenceStatus === 'error' ? '参考素材读取失败' : '暂无参考素材'}</div>}
    </section>
    <div className="prompt-toolbar" role="toolbar" aria-label="提示词工具栏">
      <Button variant="ghost" size="icon" title="撤销" aria-label="撤销" disabled={disabled || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><FontAwesomeIcon icon={faRotateLeft} /></Button>
      <Button variant="ghost" size="icon" title="重做" aria-label="重做" disabled={disabled || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><FontAwesomeIcon icon={faRotateRight} /></Button>
      {([{ kind: 'image', label: '图片引用' }, { kind: 'video', label: '视频引用' }, { kind: 'audio', label: '音频引用' }] as const).map((item) => <SelectField key={item.kind} aria-label={item.label} value="" disabled={disabled || !references.some((reference) => reference.kind === item.kind)} onChange={(event) => insertReference(event.target.value)}>
        <SelectOption value="">{item.label}</SelectOption>{references.filter((reference) => reference.kind === item.kind).map((reference) => <SelectOption key={reference.id} value={reference.label}>{reference.label} · {reference.name}</SelectOption>)}</SelectField>)}
      <Button variant="ghost" size="small" title="插入主体标签" disabled={disabled} onClick={() => insertReference(`<Subject ${next(/<Subject (\d+)>/g)}>`)}><FontAwesomeIcon icon={faUser} />主体</Button>
      <Button variant="ghost" size="small" title="插入镜头编号" disabled={disabled} onClick={() => { const number = next(/\[Shot (\d+)\]/g); insert(`[Shot ${number}]${number > 1 ? ' At ' : ' '}`) }}><FontAwesomeIcon icon={faFilm} />镜头</Button>
      <Button variant="ghost" size="small" title="插入时间点" disabled={disabled} onClick={() => { setTime(''); setTool('time') }}><FontAwesomeIcon icon={faClock} />时间</Button>
      <Button variant="ghost" size="small" title="插入说话人编号" disabled={disabled} onClick={() => insert(`(S${next(/\(S(\d+)\)/g)}) `)}><FontAwesomeIcon icon={faMicrophone} />说话人</Button>
      <Button variant="ghost" size="small" title="插入对白" disabled={disabled} onClick={() => setTool('dialogue')}><FontAwesomeIcon icon={faComment} />对白</Button>
      <Button variant="ghost" size="small" title="插入跨镜头语音标记" disabled={disabled} onClick={() => insert('<scenetrans>')}><FontAwesomeIcon icon={faArrowsLeftRight} />跨镜头</Button>
      <Button variant="ghost" size="small" title="插入语音截断标记" disabled={disabled} onClick={() => insert('<cutoff>')}><FontAwesomeIcon icon={faScissors} />截断</Button>
      <SelectField aria-label="插入结构段" value="" disabled={disabled} onChange={(event) => insert(`\n${event.target.value}:\n`)}><SelectOption value="">结构段</SelectOption>{h3Sections.map((section) => <SelectOption value={section} key={section}>{section}</SelectOption>)}</SelectField>
      <Button variant="ghost" size="icon" title="加粗" aria-label="加粗" aria-pressed={editor?.isActive('bold') ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><FontAwesomeIcon icon={faBold} /></Button>
      <Button variant="ghost" size="icon" title="斜体" aria-label="斜体" aria-pressed={editor?.isActive('italic') ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><FontAwesomeIcon icon={faItalic} /></Button>
      <Button type="button" variant="ghost" size="small" title="检查结构及素材引用" disabled={disabled || busy} onMouseDown={(event) => event.preventDefault()} onClick={onCheckStructure}><FontAwesomeIcon icon={faListCheck} />检查结构</Button>
      <Button variant="ghost" size="icon" title={expanded ? '收起编辑器' : '展开编辑器'} aria-label={expanded ? '收起编辑器' : '展开编辑器'} onClick={() => setExpanded(!expanded)}><FontAwesomeIcon icon={expanded ? faCompress : faExpand} /></Button>
    </div>
    <div className="prompt-drop-area" onDragOver={(event) => {
      if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('application/x-workbench-reference')) {
        event.preventDefault(); event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy'
      }
    }} onDrop={(event) => {
      // 编辑器内的落点由 Tiptap 处理；空白边缘也接收文件，防止浏览器导航到文件。
      if (event.defaultPrevented || !event.dataTransfer.files.length) return
      event.preventDefault()
      if (!disabled && !busy) onDropFiles(Array.from(event.dataTransfer.files))
    }}><EditorContent editor={editor} className="prompt-content" /></div>
    <div className="prompt-reference-bar"><span className="muted">拖入图片、视频或音频自动识别；拖动素材标签插入引用</span><span className="prompt-character-count">{text.length.toLocaleString()} 字符</span></div>
    </div>
    {tool && <Dialog title={tool === 'time' ? '时间点' : '对白'} onClose={() => setTool(null)}><form onSubmit={(event) => {
      event.preventDefault()
      if (tool === 'time') {
        const seconds = Number(time)
        if (!time || !Number.isFinite(seconds) || seconds < 0 || seconds >= duration) return
        const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
        insert(`${minutes}:${(seconds % 60).toFixed(3).padStart(6, '0')}, `)
      } else {
        if (!speech.trim() || speaker < 1 || !Number.isInteger(speaker)) return
        insert(`(S${speaker}) says, <d>[${language}] ${speech}</d>`)
        setSpeech('')
      }
      setTool(null)
    }}>{tool === 'time' ? <><label className="field-label" htmlFor="prompt-time">秒</label><Input id="prompt-time" type="number" min={0} max={Math.max(0, duration - .001)} step={.001} required value={time} onChange={(event) => setTime(event.target.value)} /></>
      : <><label className="field-label" htmlFor="prompt-speaker">说话人编号</label><Input id="prompt-speaker" type="number" min={1} max={100} required value={speaker} onChange={(event) => setSpeaker(Number(event.target.value))} />
        <label className="field-label" htmlFor="prompt-language">语言</label><SelectField id="prompt-language" value={language} onChange={(event) => setLanguage(event.target.value)}>{['Chinese', 'English', 'Japanese', 'Korean', 'French', 'Spanish'].map((item) => <SelectOption key={item}>{item}</SelectOption>)}</SelectField>
        <label className="field-label" htmlFor="prompt-speech">对白原文</label><Textarea id="prompt-speech" required value={speech} onChange={(event) => setSpeech(event.target.value)} /></>}
      <div className="dialog-actions"><Button variant="outline" onClick={() => setTool(null)}>取消</Button><Button type="submit">插入</Button></div></form></Dialog>}
  </div>
}
