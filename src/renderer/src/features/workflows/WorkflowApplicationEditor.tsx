import { useEffect, useRef, useState } from 'react'
import Sortable from 'sortablejs'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGripLines, faCheck, faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import type { Workflow, WorkflowApplication } from '@contracts/workflows'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { SelectField, SelectOption } from '@/components/ui/select-field'

const visibilityLabels = { common: '常用', advanced: '高级', fixed: '固定' }

export function WorkflowApplicationEditor({ workflow, onSave, onCancel, onDirty }: { workflow: Workflow;
  onSave: (fields: WorkflowApplication['fields']) => Promise<void>; onCancel: () => void; onDirty: (dirty: boolean) => void }) {
  const [fields, setFields] = useState(() => workflow.application?.fields ?? [])
  const [activeKey, setActiveKey] = useState(() => fields[0]?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const suppressClickUntil = useRef(0)
  const changed = JSON.stringify(fields) !== JSON.stringify(workflow.application?.fields ?? [])
  useEffect(() => { onDirty(changed) }, [changed, onDirty])
  useEffect(() => {
    if (!list.current) return
    let initialKeys: string[] = []
    const scrollContainer = list.current
    const sortable = Sortable.create(scrollContainer, {
      animation: 150, disabled: busy, draggable: '.workflow-field-row', handle: '.workflow-field-grip',
      delay: 150, delayOnTouchOnly: true, touchStartThreshold: 4,
      ghostClass: 'workflow-field-ghost', chosenClass: 'workflow-field-chosen',
      // Chromium 原生拖拽依赖浏览器滚动，嵌套列表中不稳定；统一使用库的拖拽和滚动实现。
      forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, fallbackClass: 'workflow-field-floating',
      forceAutoScrollFallback: true, scroll: scrollContainer, bubbleScroll: false, scrollSensitivity: 64, scrollSpeed: 12,
      onStart: () => { initialKeys = Array.from(list.current?.children ?? []).map((child) => (child as HTMLElement).dataset.fieldKey ?? ''); suppressClickUntil.current = Infinity },
      onEnd: ({ oldIndex, newIndex, item, from }) => {
        suppressClickUntil.current = Date.now() + 250
        // 恢复 Sortable 改动的 DOM，再让 React 根据字段状态重排，保持选中项和输入值一致。
        const siblings = Array.from(from.children).filter((child) => child !== item)
        if (oldIndex !== undefined) from.insertBefore(item, siblings[oldIndex] ?? null)
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
        setFields((current) => {
          if (current.length !== initialKeys.length || current.some((field, index) => field.key !== initialKeys[index])) return current
          const next = [...current]; const moved = next.splice(oldIndex, 1)[0]
          if (!moved) return current
          next.splice(newIndex, 0, moved); return next
        })
        setAnnouncement(`字段已移至第 ${newIndex + 1} 项`)
      }
    })
    return () => { sortable.destroy(); suppressClickUntil.current = 0 }
  }, [busy])
  const update = (key: string, patch: Partial<WorkflowApplication['fields'][number]>) => setFields((current) => current.map((field) => field.key === key ? { ...field, ...patch } : field))
  const moveTo = (key: string, target: number) => {
    setFields((current) => {
      const index = current.findIndex((field) => field.key === key)
      if (index === -1 || !Number.isInteger(target) || target < 0 || target >= current.length) return current
      const next = [...current]; const moved = next.splice(index, 1)[0]!
      next.splice(target, 0, moved); return next
    })
    setAnnouncement(`字段已移至第 ${target + 1} 项`)
  }
  const activeIndex = fields.findIndex((field) => field.key === activeKey)
  const configured = fields[activeIndex]
  const source = workflow.form?.fields.find((field) => field.key === activeKey)
  const media = source?.type === 'audio' || source?.type === 'image'
  return <form className="workflow-application-editor" noValidate onSubmit={async (event) => {
    event.preventDefault()
    const invalid = fields.find((field) => !field.label.trim() || field.label.length > 150 || (workflow.form?.fields.find((item) => item.key === field.key)?.type === 'number' && (typeof field.defaultValue !== 'number' || !Number.isFinite(field.defaultValue))))
    if (invalid) { setActiveKey(invalid.key); setError('请填写有效的显示名称和默认值'); return }
    setBusy(true); setError('')
    try { await onSave(fields); onDirty(false) } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') } finally { setBusy(false) }
  }}><header className="workflow-editor-intro"><div><h3>编辑快捷应用</h3><p className="muted">拖动左侧字段排序，点击字段编辑。固定参数隐藏后仍会正常提交。</p></div><span className="workflow-edit-state">{changed ? '有未保存修改' : '未修改'}</span></header>
    {workflow.application?.needsReview && <p className="field-error" role="alert">线上输入已变化，请复核字段和默认值后保存。</p>}
    <fieldset className="workflow-editor-body" disabled={busy}><aside className="workflow-field-sidebar"><header><strong>字段列表 <span>{fields.length}</span></strong><small>拖动手柄调整顺序</small></header>
      <div className="workflow-field-list" ref={list}>{fields.map((field, index) => <div className={`workflow-field-row ${field.key === activeKey ? 'active' : ''}`} key={field.key} data-field-key={field.key}>
        <Button variant="unstyled" className="workflow-field-grip" aria-label={`拖动排序 ${field.label}`} title="拖动排序；键盘上下方向键移动，Home / End 移到首尾" onKeyDown={(event) => {
          const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? fields.length - 1 : null
          if (target !== null) { event.preventDefault(); if (target >= 0 && target < fields.length) moveTo(field.key, target) }
        }}><FontAwesomeIcon icon={faGripLines} /></Button>
        <Button variant="unstyled" className="workflow-field-select" aria-pressed={field.key === activeKey} onClick={() => { if (Date.now() >= suppressClickUntil.current) setActiveKey(field.key) }}><span className="workflow-field-name"><span className="workflow-field-number">{index + 1}</span><strong title={field.label}>{field.label || '未命名字段'}</strong></span><span className={`workflow-field-badge ${field.visibility}`}>{visibilityLabels[field.visibility]}</span></Button>
      </div>)}</div>
    </aside><section className="workflow-field-settings" aria-label="选中字段设置">{configured && source ? <div className="workflow-settings-content"><header><span className="muted">字段设置 · {activeIndex + 1} / {fields.length}</span><h3>{configured.label || '未命名字段'}</h3><p className="muted">原字段：{source.title}</p></header>
      <label className="parameter-field">显示名称<Input maxLength={150} value={configured.label} onChange={(event) => update(configured.key, { label: event.target.value })} /></label>
      <div className="workflow-editor-field-options"><label className="parameter-field">显示位置<SelectField value={configured.visibility} onChange={(event) => update(configured.key, { visibility: event.target.value as typeof configured.visibility })}><SelectOption value="common">常用输入</SelectOption><SelectOption value="advanced">高级设置</SelectOption>{!media && <SelectOption value="fixed">固定参数（隐藏）</SelectOption>}</SelectField></label>
        <label className="parameter-field">排序位置<Input key={`${configured.key}-${activeIndex}`} type="number" min={1} max={fields.length} defaultValue={activeIndex + 1} onBlur={(event) => {
          const target = event.target.valueAsNumber
          if (Number.isInteger(target) && target >= 1 && target <= fields.length) moveTo(configured.key, target - 1)
          else event.target.value = String(activeIndex + 1)
        }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /></label>
      </div>
      {source.type === 'text' && <label className="parameter-field">输入方式<SelectField value={configured.control} onChange={(event) => update(configured.key, { control: event.target.value as typeof configured.control })}><SelectOption value="singleline">单行文本</SelectOption><SelectOption value="multiline">多行文本</SelectOption></SelectField></label>}
      {!media ? <label className="parameter-field workflow-default-value">默认值{source.type === 'boolean' ? <span className="workflow-boolean-default"><CheckboxField checked={configured.defaultValue === true} onChange={(event) => update(configured.key, { defaultValue: event.target.checked })} />{configured.defaultValue === true ? '开启' : '关闭'}</span>
        : source.type === 'number' ? <Input type="number" step="any" value={String(configured.defaultValue)} onChange={(event) => update(configured.key, { defaultValue: event.target.value === '' ? '' : event.target.valueAsNumber })} />
          : configured.control === 'multiline' ? <Textarea value={String(configured.defaultValue)} onChange={(event) => update(configured.key, { defaultValue: event.target.value })} />
            : <Input value={String(configured.defaultValue)} onChange={(event) => update(configured.key, { defaultValue: event.target.value })} />}</label>
        : <p className="workflow-setting-note">参考素材在运行时选择，此处仅配置名称、位置和顺序。</p>}
      <p className="workflow-setting-note">{{ common: '常用输入直接显示在运行界面。', advanced: '高级输入收纳在折叠区，保留默认值。', fixed: '固定参数不显示在运行界面，始终使用这里的默认值。' }[configured.visibility]}</p>
    </div> : <p className="muted">请从左侧选择字段</p>}</section></fieldset>
    <footer className="workflow-editor-actions"><div className="workflow-editor-feedback">{error ? <p className="field-error" role="alert">{error}</p> : <span className="muted">{fields.filter((field) => field.visibility === 'common').length} 项常用 · {fields.filter((field) => field.visibility === 'advanced').length} 项高级 · {fields.filter((field) => field.visibility === 'fixed').length} 项固定</span>}<span className="sr-only" aria-live="polite">{announcement}</span></div><div className="button-row"><Button variant="outline" disabled={busy} onClick={onCancel}><FontAwesomeIcon icon={faArrowLeft} />取消编辑</Button><Button type="submit" disabled={busy}><FontAwesomeIcon icon={faCheck} />{busy ? '保存中' : '保存应用'}</Button></div></footer>
  </form>
}
