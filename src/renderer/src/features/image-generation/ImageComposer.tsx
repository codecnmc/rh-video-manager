import { Controller, useFormState, useWatch, type UseFormReturn } from 'react-hook-form'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faXmark, faFloppyDisk, faArrowUp, faCopy, faRotateRight, faEye, faChevronDown, faChevronUp, faExpand, faArrowLeft, faArrowRight, faUpload } from '@fortawesome/free-solid-svg-icons'
import type { ImageAccount, ImageNode } from '@contracts/image-generation'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { imageStatusLabel } from './image-labels'
import { ImageTaskElapsed } from './ImageTaskElapsed'
import { memo, useId, useRef, useState } from 'react'
import type { ImageGenerationController } from './use-image-generation'
import type { ImageTaskFields } from './task-editor-state'
import { ImageSizePicker } from './ImageSizePicker'
import { CopyableAssetImage } from '@/features/assets'
import { canRegenerateImageTask } from './task-versions'

export type ImageComposerFields = ImageTaskFields

function ImageComposerErrors({ form }: { form: UseFormReturn<ImageComposerFields> }) {
  const { errors } = useFormState({ control: form.control })
  return <>{Object.values(errors).map((error, index) => <p className="field-error" role="alert" key={index}>{error.message ?? '请检查参考图片'}</p>)}</>
}

// 表单状态、自动保存和提示词更新不应重建账号与尺寸选择器的整个弹层树。
const ImageComposerOptions = memo(function ImageComposerOptions({ form, accounts, disabled, accountSnapshot }: {
  form: UseFormReturn<ImageComposerFields>; accounts: ImageAccount[]; disabled: boolean
  accountSnapshot: ImageNode['accountSnapshot'] | undefined
}) {
  return <div className="image-composer-options">
    <div className="image-composer-account-field">{accountSnapshot ? <span className="image-composer-account" title={accountSnapshot.id}>{accountSnapshot.name} · {accountSnapshot.model}</span> : <Controller name="accountId" control={form.control} render={({ field }) => <SelectField aria-label="生图账号" disabled={disabled} value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value || null)}>
      <SelectOption value="">自动调度账号</SelectOption>{accounts.map((account) => <SelectOption key={account.id} value={account.id} disabled={!account.enabled || account.stopped}>{account.name} · {account.model}</SelectOption>)}
    </SelectField>} />}</div>
    <div className="image-composer-size-field"><Controller name="size" control={form.control} render={({ field }) => <ImageSizePicker value={field.value} disabled={disabled} onChange={field.onChange} />} /></div>
  </div>
})

export function ExpandedImagePrompt({ form, disabled, onChange }: { form: UseFormReturn<ImageComposerFields>; disabled: boolean; onChange: () => void }) {
  const prompt = useWatch({ control: form.control, name: 'prompt' })
  return <textarea aria-label="放大编辑图片生成提示词" autoFocus value={prompt} onChange={(event) => {
    form.setValue('prompt', event.target.value, { shouldDirty: true })
    onChange()
  }} readOnly={disabled} maxLength={50000} />
}

export function ImageComposer({ form, node, accounts, assets, readOnly, dirty, control, onSave, onGenerate, onClose,
  externalChanges, onReload, onAddReferences, onRemoveReference, onMoveReference, onPasteImages, onPreview }: {
  form: UseFormReturn<ImageComposerFields>; node: ImageNode | null; accounts: ImageAccount[]; assets: Asset[];
  readOnly: boolean; dirty: boolean; control: ImageGenerationController;
  externalChanges: boolean; onReload: () => void;
  onSave: () => void; onGenerate: () => void; onClose: () => void; onAddReferences: () => void;
  onRemoveReference: (assetId: string) => void; onPasteImages: (files: File[]) => void;
  onMoveReference: (index: number, offset: number) => void;
  onPreview: (asset: Asset) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [promptNotice, setPromptNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const bodyId = useId()
  const references = useWatch({ control: form.control, name: 'references' })
  const disabled = readOnly || control.busy
  const result = assets.find((asset) => asset.id === node?.assetId)
  const regenerating = Boolean(node && canRegenerateImageTask(node))
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(form.getValues('prompt'))
      setPromptNotice('已复制')
    } catch { setPromptNotice('复制失败，请选择文字后复制') }
  }
  const composer = <form className={`image-composer nodrag nopan ${collapsed ? 'is-collapsed' : ''}`} aria-label="图片任务编辑器" onSubmit={(event) => { event.preventDefault(); onSave() }} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !readOnly && !control.busy && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onGenerate() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !readOnly) { event.preventDefault(); event.stopPropagation(); if (!control.busy) onSave() }
  }} onPaste={(event) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault(); event.stopPropagation()
    if (!disabled) onPasteImages(files)
  }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation() } }} onDrop={(event) => {
    event.preventDefault(); event.stopPropagation()
    const files = Array.from(event.dataTransfer.files)
    if (files.length && !disabled) onPasteImages(files)
  }}>
    <div className="image-composer-heading"><Input aria-label="任务名称" {...form.register('title')} readOnly={disabled} maxLength={120} />
      <span className="image-composer-state">{externalChanges ? '外部更新' : dirty ? '未保存' : node ? imageStatusLabel(node.status) : '新任务'}</span>
      <Button type="button" variant="ghost" size="icon" title={collapsed ? '展开提示词面板' : '收起提示词面板'} aria-label={collapsed ? '展开提示词面板' : '收起提示词面板'} aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed((value) => !value)}><FontAwesomeIcon icon={collapsed ? faChevronDown : faChevronUp} /></Button>
      <Button type="button" variant="ghost" size="icon" title="关闭编辑器" aria-label="关闭编辑器" disabled={control.busy} onClick={onClose}><FontAwesomeIcon icon={faXmark} /></Button>
    </div>
    <div id={bodyId} className="image-composer-body" hidden={collapsed}>
    {externalChanges && <div className="field-error" role="alert">其他窗口已更新此任务。本地修改已保留，保存和生成已暂停。
      <Button type="button" variant="outline" disabled={control.busy} onClick={onReload}>重新载入</Button></div>}
    <div className="image-composer-references" aria-label="参考图片"><div className="image-reference-heading"><span className="image-reference-label">参考图 <span className="image-reference-count">{references.length}/16</span></span>{!readOnly && <div className="image-reference-tools"><Button type="button" variant="ghost" size="icon" title="从素材库选择参考图" aria-label="从素材库选择参考图" disabled={control.busy || references.length >= 16} onClick={onAddReferences}><FontAwesomeIcon icon={faPlus} /></Button><Button type="button" variant="ghost" size="icon" title="导入本地参考图" aria-label="导入本地参考图" disabled={control.busy || references.length >= 16} onClick={() => fileInput.current?.click()}><FontAwesomeIcon icon={faUpload} /></Button></div>}</div>
      <div className="image-reference-items">
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length && !disabled) onPasteImages(files) }} />
      {references.map((reference, index) => {
      const asset = assets.find((item) => item.id === reference.assetId)
      return <div key={reference.assetId} className="image-composer-reference" title={asset?.name ?? '图片不可用'}>
        <button type="button" onClick={() => { if (asset) onPreview(asset) }} aria-label={`查看参考图片 ${index + 1}`} disabled={!asset}>{asset && <CopyableAssetImage assetId={asset.id} disabled={asset.archived} alt={asset.name} draggable={false} />}<span>图片 {index + 1}</span></button>
        {!readOnly && <Button type="button" variant="ghost" size="icon" className="image-reference-remove" title={`解除参考：${asset?.name ?? index + 1}`} aria-label={`解除参考图片 ${index + 1}`} disabled={control.busy} onClick={() => onRemoveReference(reference.assetId)}><FontAwesomeIcon icon={faXmark} /></Button>}
        {!readOnly && <div className="image-reference-order"><Button type="button" variant="ghost" size="icon" title="引用图前移" aria-label={`引用图 ${index + 1} 前移`} disabled={disabled || index === 0} onClick={() => onMoveReference(index, -1)}><FontAwesomeIcon icon={faArrowLeft} /></Button><Button type="button" variant="ghost" size="icon" title="引用图后移" aria-label={`引用图 ${index + 1} 后移`} disabled={disabled || index === references.length - 1} onClick={() => onMoveReference(index, 1)}><FontAwesomeIcon icon={faArrowRight} /></Button></div>}
        <span className="image-reference-name">{asset?.name ?? '图片不可用'}</span>
      </div>
    })}{!readOnly && <Button type="button" variant="outline" className="image-composer-add" title="从素材库添加参考图片" disabled={control.busy || references.length >= 16} onClick={onAddReferences}><FontAwesomeIcon icon={faPlus} /><span>参考图</span></Button>}</div></div>
    <div className="image-prompt-heading"><label htmlFor={`${bodyId}-prompt`}>提示词</label><span className="image-prompt-notice" role="status">{promptNotice}</span><div className="button-row">
      <Button type="button" variant="ghost" size="icon" title="复制提示词" aria-label="复制提示词" onClick={() => void copyPrompt()}><FontAwesomeIcon icon={faCopy} /></Button>
      <Button type="button" variant="ghost" size="icon" title="放大编辑提示词" aria-label="放大编辑提示词" onClick={() => setExpanded(true)}><FontAwesomeIcon icon={faExpand} /></Button>
    </div></div><textarea id={`${bodyId}-prompt`} aria-label="图片生成提示词" placeholder="描述要生成的画面…" {...form.register('prompt', { onChange: () => setPromptNotice('') })} readOnly={disabled} maxLength={50000} rows={14} />
    <ImageComposerErrors form={form} />
    {node?.error && <p className="field-error image-composer-error" role="status">{node.error}</p>}
    {node && (node.submittedAt || ['queued', 'preparing'].includes(node.status)) && <p className="muted"><ImageTaskElapsed node={node} /></p>}
    <div className="image-composer-bottom"><ImageComposerOptions form={form} accounts={accounts} disabled={disabled} accountSnapshot={readOnly ? node?.accountSnapshot : undefined} /><div className={`button-row image-composer-primary-actions ${result ? 'has-result' : ''}`}>
      {result && <Button type="button" variant="outline" className="image-composer-view-result" onClick={() => onPreview(result)}><FontAwesomeIcon icon={faEye} />查看结果</Button>}
      {!readOnly && <span className="image-composer-save-state" role="status">{dirty || !node ? '未保存' : '已保存'}</span>}
      {!readOnly && <Button type="submit" variant="outline" title={regenerating ? '另存为新草稿，保留原生成记录，不提交生成' : '保存任务，不提交生成'} disabled={control.busy}><FontAwesomeIcon icon={faFloppyDisk} />保存草稿</Button>}
      <Button type="button" className="image-composer-generate" title={regenerating ? '确认费用后重新生成，保留原图片和记录' : '保存并确认费用后生成'} disabled={disabled} onClick={onGenerate}><FontAwesomeIcon icon={regenerating ? faRotateRight : faArrowUp} />{regenerating ? '重新生成' : '确认生成'}</Button>
    </div></div>
    {node?.accountSnapshot && <div className="image-composer-provenance"><span title={`${node.accountSnapshot.id} · ${node.accountSnapshot.accountGroup}`}>生成账号：{node.accountSnapshot.name}</span><span>{node.accountSnapshot.model}</span><span>{node.accountSnapshot.baseUrl}</span></div>}
    {!externalChanges && node && ['queued', 'acceptance_unknown', 'output_unavailable', 'downloading'].includes(node.status) && <div className="image-composer-task-actions button-row">
      {node.status === 'queued' && <Button type="button" variant="outline" disabled={control.busy} onClick={() => void control.cancelQueued(node)}>撤回排队</Button>}
      {node.status === 'acceptance_unknown' && <Button type="button" variant="outline" disabled={control.busy} onClick={() => void control.resolveUnknown(node)}>核实结束并解除占用</Button>}
      {(node.status === 'output_unavailable' || node.status === 'downloading') && <Button type="button" variant="outline" aria-busy={node.status === 'downloading' || control.recoveringOutputId === node.id} disabled={control.busy || node.status === 'downloading'} onClick={() => void control.retryOutput(node)}>{node.status === 'downloading' || control.recoveringOutputId === node.id ? '正在下载归档…' : '恢复下载归档'}</Button>}
    </div>}
    </div>
  </form>
  // 放大视图复用同一表单值，侧栏不卸载，保留其输入和滚动位置。
  return <>{composer}{expanded && <Dialog title="提示词" className="image-prompt-dialog" onClose={() => setExpanded(false)}>
    <ExpandedImagePrompt form={form} disabled={disabled} onChange={() => setPromptNotice('')} />
    <div className="image-prompt-dialog-footer"><span className="image-prompt-notice" role="status">{promptNotice}</span><Button variant="ghost" onClick={() => void copyPrompt()}><FontAwesomeIcon icon={faCopy} />复制</Button><Button onClick={() => setExpanded(false)}>完成</Button></div>
  </Dialog>}</>
}
