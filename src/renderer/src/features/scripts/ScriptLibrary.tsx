import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faFloppyDisk, faTrash, faRotateRight, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { saveLibraryDocumentSchema, type LibraryDocument, type SaveLibraryDocument } from '@contracts/script-library'
import type { AppPreferences } from '@contracts/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { MarkdownEditor, MarkdownModeControl } from '@/shared/components/MarkdownEditor'
import { usePreferences } from '@/features/settings'
import { useScriptLibrary } from './use-script-library'
import { useScriptLibraryUi } from './script-library-store'
import './script-library.css'

function DocumentEditor({ document, preferences, saving, onDirty, onSave, onTitleChange }: {
  document: SaveLibraryDocument; preferences: AppPreferences; saving: boolean;
  onDirty: (dirty: boolean) => void; onSave: (input: SaveLibraryDocument) => Promise<LibraryDocument>
  onTitleChange: (title: string) => void
}) {
  const form = useForm<SaveLibraryDocument>({ resolver: zodResolver(saveLibraryDocumentSchema), defaultValues: document })
  const [mode, setMode] = useState(preferences.editorMode)
  const { isDirty, isSubmitting } = form.formState
  const changed = isDirty || form.watch('expectedRevision') === null
  const currentRevision = form.watch('expectedRevision')
  const externallyChanged = currentRevision !== document.expectedRevision
  useEffect(() => {
    // 只同步干净表单；脏表单保留原修订号，让保存冲突校验继续生效。
    if (!changed && externallyChanged) form.reset(document)
  }, [changed, externallyChanged, document, form])
  useEffect(() => { onDirty(changed) }, [changed, onDirty])
  const [error, setError] = useState('')
  return <form className="script-library-editor" onSubmit={form.handleSubmit(async (input) => {
    setError('')
    try {
      const saved = await onSave(input)
      form.reset({ id: saved.id, projectId: saved.projectId, title: saved.title, markdown: saved.markdown, expectedRevision: saved.revision })
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') }
  })}><div className="script-library-toolbar"><Input aria-label="文档名称" maxLength={100} disabled={saving || isSubmitting} value={form.watch('title')} onChange={(event) => {
    form.setValue('title', event.target.value, { shouldDirty: true, shouldValidate: true }); onTitleChange(event.target.value)
  }} />
    <div className="script-library-controls"><MarkdownModeControl mode={mode} onChange={setMode} />
      <Button type="submit" disabled={!changed || saving || isSubmitting}><FontAwesomeIcon icon={faFloppyDisk} />保存</Button></div></div>
    {changed && externallyChanged && <p className="field-error" role="status">文档已有外部更新，未保存的修改已保留。可通过刷新按钮确认放弃修改并载入最新内容。</p>}
    {(error || form.formState.errors.title || form.formState.errors.markdown) && <p className="field-error" role="alert">{error || form.formState.errors.title?.message || form.formState.errors.markdown?.message}</p>}
    <MarkdownEditor value={form.watch('markdown')} onChange={(value) => form.setValue('markdown', value, { shouldDirty: true, shouldValidate: true })} mode={mode} fontSize={preferences.editorFontSize} disabled={saving || isSubmitting} />
    <div className="script-footer"><span>{changed ? '未保存' : '已保存'}</span><span>{form.watch('markdown').length.toLocaleString()} 字</span></div>
  </form>
}

type ScriptLibraryProps = { projectId: string | null; onDirty: (dirty: boolean) => void; onNotice: (message: string) => void }

export function ScriptLibrary(props: ScriptLibraryProps) {
  const unassigned = useScriptLibraryUi((state) => state.unassignedByProject[props.projectId ?? 'unassigned'] ?? false)
  const setUnassigned = useScriptLibraryUi((state) => state.setUnassigned)
  const scope = unassigned ? null : props.projectId
  return <ScopedScriptLibrary key={scope ?? 'unassigned'} {...props} scope={scope} onScopeChange={(value) => setUnassigned(props.projectId, value)} />
}

function ScopedScriptLibrary({ projectId, scope, onScopeChange, onDirty, onNotice }: ScriptLibraryProps & {
  scope: string | null; onScopeChange: (unassigned: boolean) => void
}) {
  const library = useScriptLibrary(scope)
  const preferences = usePreferences()
  const selectedId = useScriptLibraryUi((state) => state.selectedByScope[scope ?? 'unassigned'] ?? null)
  const selectDocument = useScriptLibraryUi((state) => state.selectDocument)
  const setSelectedId = (id: string | null) => selectDocument(scope, id)
  const [draft, setDraft] = useState<SaveLibraryDocument | null>(null)
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const [version, setVersion] = useState(0)
  const selected = library.data?.find((item) => item.id === selectedId)
  const document = draft ?? (selected ? { id: selected.id, projectId: selected.projectId, title: selected.title, markdown: selected.markdown, expectedRevision: selected.revision } : null)
  const busy = library.save.isPending || library.remove.isPending || library.assign.isPending
  const changed = useCallback((value: boolean) => { setDirty(value); onDirty(value) }, [onDirty])
  async function switchDocument(action: () => void | Promise<void>) {
    if (busy || (dirty && !await confirmAction('放弃当前文档未保存的修改？'))) return
    await action(); changed(false); setVersion((current) => current + 1)
  }
  function createDocument() {
    void switchDocument(() => { setSelectedId(null); setSearch(''); setDraft({ id: crypto.randomUUID(), projectId: scope, title: '未命名文档', markdown: '', expectedRevision: null }) })
  }
  const visibleDocuments = (library.data ?? []).filter((item) => `${item.title}\n${item.markdown}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <section className="script-library-page"><aside className="script-library-list"><div className="script-library-heading"><h2>剧本库</h2>
    <div className="script-library-controls"><Button variant="ghost" size="icon" title="刷新剧本库" aria-label="刷新剧本库" disabled={busy} onClick={() => void switchDocument(async () => { await library.refetch(); setDraft(null) })}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Button variant="ghost" size="icon" title="新建文档" aria-label="新建文档" disabled={busy || !preferences.data} onClick={createDocument}><FontAwesomeIcon icon={faPlus} /></Button></div></div>
    <div className="script-library-search"><SelectField aria-label="剧本归属范围" value={scope === null ? 'unassigned' : 'project'} disabled={busy} onChange={(event) => { const unassigned = event.target.value === 'unassigned'; void switchDocument(() => onScopeChange(unassigned)) }}>
      {projectId && <SelectOption value="project">当前项目</SelectOption>}<SelectOption value="unassigned">未归属剧本</SelectOption>
    </SelectField><Input aria-label="搜索剧本库" placeholder="搜索标题或正文" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="script-library-items">{draft && <div className="script-library-item selected" aria-current="page"><strong>{draft.title || '未命名文档'}</strong><small>未保存</small></div>}
      {visibleDocuments.map((item) =>
      <Button variant="unstyled" key={item.id} className={`script-library-item ${document?.id === item.id ? 'selected' : ''}`} disabled={busy} onClick={() => { if (document?.id !== item.id) void switchDocument(() => { setDraft(null); setSelectedId(item.id) }) }}>
        <strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></Button>)}
      {library.isPending && <p className="script-library-list-message">正在读取</p>}{!library.isPending && !draft && !visibleDocuments.length && <p className="script-library-list-message">{search ? '没有匹配的文档' : '暂无文档'}</p>}</div>
    {selected && !draft && <Button variant="ghost" disabled={busy} onClick={async () => {
      if (!await confirmAction(`删除「${selected.title}」？记录保留，当前未保存修改将放弃。`)) return
      try { await library.remove.mutateAsync({ id: selected.id, projectId: scope, expectedRevision: selected.revision }); changed(false); setSelectedId(null); onNotice('文档已删除，底层记录保留') }
      catch (failure) { onNotice(failure instanceof Error ? failure.message : '删除失败') }
    }}><FontAwesomeIcon icon={faTrash} />删除文档</Button>}
    {selected && !draft && scope === null && projectId && <Button variant="outline" disabled={busy || dirty} onClick={async () => {
      if (!await confirmAction(`将「${selected.title}」归入当前项目？`)) return
      try {
        await library.assign.mutateAsync({ id: selected.id, projectId, expectedRevision: selected.revision })
        setSelectedId(null); onNotice('文档已归入当前项目')
      } catch (failure) { onNotice(failure instanceof Error ? failure.message : '归属修改失败') }
    }}><FontAwesomeIcon icon={faArrowRight} />归入当前项目</Button>}</aside>
    <div className="script-library-content">{(library.error || preferences.error) && <p className="field-error" role="alert">{library.error?.message || preferences.error?.message}</p>}
      {document && preferences.data ? <DocumentEditor key={`${document.id}-${version}`} document={document} preferences={preferences.data} saving={busy} onDirty={changed} onTitleChange={(title) => setDraft((current) => current ? { ...current, title } : null)} onSave={async (input) => {
        const saved = await library.save.mutateAsync(input)
        setSelectedId(saved.id); setDraft(null); onNotice('文档已保存到本地 SQLite'); return saved
      }} /> : <div className="script-library-empty"><span>选择文档</span><Button variant="outline" disabled={busy || !preferences.data} onClick={createDocument}><FontAwesomeIcon icon={faPlus} />新建文档</Button></div>}</div>
  </section>
}
