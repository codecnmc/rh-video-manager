import { VoicePicker } from '@/features/voices'
import { confirmAction, showMessage } from '@/components/ui/confirmation'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faFloppyDisk, faTriangleExclamation, faPlay, faGear, faXmark } from '@fortawesome/free-solid-svg-icons'
import { videoDraftSchema, type VideoDraft } from '@contracts/video'
import type { DraftReference } from '@contracts/references'
import type { Asset } from '@contracts/assets'
import { h3PromptSchema } from '@contracts/h3'
import { continuousShotInputSchema } from '@contracts/continuity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PromptEditor } from '@/features/prompt-editor'
import { useDraftReferences } from '@/features/references'
import { AssetPicker } from '@/features/assets'
import { selectInstanceTier } from './instance-policy'
import { DialogueProduction, useSpeechCapabilities } from '@/features/production'
import { useGeneration } from './use-generation'
import { useWorkflows } from '@/features/workflows'

interface VideoInspectorProps {
  draft: VideoDraft
  projectId: string
  saved: boolean
  saving: boolean
  externalChanges: boolean
  onSave: (draft: VideoDraft) => Promise<void>
  onDirty: (dirty: boolean) => void
  onNotice: (message: string) => void
  onSubmitted: (taskId: string) => void
  initialTab?: 'video' | 'dialogue'
}

export function VideoInspector({ draft, projectId, saved, saving, externalChanges, onSave, onDirty, onNotice, onSubmitted, initialTab = 'video' }: VideoInspectorProps) {
  const formId = useId()
  const form = useForm<z.input<typeof videoDraftSchema>, unknown, VideoDraft>({ resolver: zodResolver(videoDraftSchema), defaultValues: draft })
  const workflows = useWorkflows()
  const supportsCombat = workflows.data?.some((workflow) => workflow.enabled && workflow.isDefault && workflow.capabilities?.combat) ?? false
  const references = useDraftReferences(draft.id, saved)
  const generation = useGeneration(projectId, draft.id, onNotice, onSubmitted)
  const [importing, setImporting] = useState(false)
  const importingRef = useRef(false)
  const [error, setError] = useState('')
  function referenceError(message: string) {
    setError(message)
    void showMessage(message)
  }
  const [parametersOpen, setParametersOpen] = useState(false)
  const [voicePicker, setVoicePicker] = useState(false)
  const [picker, setPicker] = useState(false)
  const [replacement, setReplacement] = useState<DraftReference | null>(null)
  const [tab, setTab] = useState<'video' | 'dialogue'>(initialTab)
  const [dialogueDirty, setDialogueDirty] = useState(false)
  const capabilities = useSpeechCapabilities()
  const hasSpeechProvider = capabilities.isSuccess && Boolean(capabilities.data?.length)
  useEffect(() => {
    if (!hasSpeechProvider) { setTab('video'); setDialogueDirty(false) }
  }, [hasSpeechProvider])
  const { isDirty } = form.formState
  const duration = form.watch('duration')
  const mode = form.watch('instanceMode') ?? 'manual'
  const instance = form.watch('instance')
  const resolution = form.watch('resolution')
  const aspectRatio = form.watch('aspectRatio')
  const imageCount = references.data?.filter((reference) => reference.kind === 'image').length ?? 0
  const referencesKnown = !saved || references.data !== undefined
  // 自动档位是派生值，不写入表单，避免仅载入草稿或参考图就产生脏状态。
  const effectiveInstance = referencesKnown && Number.isInteger(duration) && duration >= 4 && duration <= 15
    ? selectInstanceTier({ duration, instance, instanceMode: mode }, imageCount) : instance
  useEffect(() => { form.reset(draft) }, [draft, form])
  useEffect(() => { onDirty(isDirty || dialogueDirty) }, [isDirty, dialogueDirty, onDirty])
  function revealParameterErrors(errors: FieldErrors<z.input<typeof videoDraftSchema>>) {
    if (errors.duration || errors.aspectRatio || errors.resolution || errors.instance || errors.instanceMode || errors.combatEnabled || errors.shotContinuity || errors.nextTransition || errors.continuityTailSeconds) setParametersOpen(true)
  }
  function normalizedDraft(value: VideoDraft): VideoDraft {
    return referencesKnown ? { ...value, instance: selectInstanceTier(value, imageCount) } : value
  }
  function checkStructure() {
    const result = h3PromptSchema.safeParse(form.getValues('prompt'))
    if (!result.success) { onNotice(result.error.issues[0]?.message ?? '提示词结构不完整'); return }
    if (!referencesKnown || references.error) { onNotice('参考素材尚未载入，暂不能完成引用检查'); return }
    const continuity = continuousShotInputSchema.safeParse({ ...form.getValues(), references: references.data ?? [] })
    if (!continuity.success) { onNotice(continuity.error.issues[0]?.message ?? '连续镜头引用不完整'); return }
    const missing = [...form.getValues('prompt').matchAll(/<(Picture|Video|Audio) [1-9]\d*>/g)]
      .find((match) => !references.data?.some((reference) => reference.label === match[0]))
    onNotice(missing ? `未绑定素材：${missing[0]}` : '结构检查通过：六节内容完整，素材引用均已绑定。')
  }
  function importReferences(action: () => Promise<void>) {
    if (externalChanges) { referenceError('已有外部新版本，请先重新载入草稿再修改参考素材'); return }
    if (generation.pending) { referenceError('视频提交中，暂不能修改参考素材'); return }
    if (importingRef.current) { referenceError('正在导入参考素材，请稍后再粘贴或添加'); return }
    importingRef.current = true
    setImporting(true); setError('')
    void action().catch((failure: unknown) => referenceError(failure instanceof Error ? failure.message : '导入失败')).finally(() => {
      importingRef.current = false
      setImporting(false)
    })
  }
  async function pickAssets(assets: Asset[]) {
    if (externalChanges) throw new Error('已有外部新版本，请先重新载入草稿再添加素材')
    if (generation.pending || saving || importingRef.current) throw new Error('正在执行其他操作，请稍后再添加素材')
    if (replacement) {
      const asset = assets[0]!
      await references.replace(replacement, asset.id, asset.updatedAt)
      onNotice(`已替换 ${replacement.label}，原素材与历史生成任务保留`)
      return
    }
    const prompt = assets.find((asset) => asset.kind === 'prompt')
    if (prompt) {
      if (form.getValues('prompt').trim() && !(await confirmAction('用素材提示词替换当前提示词？'))) return
      form.setValue('prompt', prompt.prompt, { shouldDirty: true, shouldValidate: true })
      form.setValue('promptDocument', '', { shouldDirty: true, shouldValidate: true })
      return
    }
    // 整批先检查上限，再保存一次草稿，避免逐项保存旧修订。
    const current = references.data ?? []
    for (const kind of ['image', 'video', 'audio'] as const) {
      const count = new Set([...current.filter((item) => item.kind === kind).map((item) => item.assetId),
        ...assets.filter((asset) => asset.kind === kind).map((asset) => asset.id)]).size
      if (count > (kind === 'image' ? 9 : 3)) throw new Error(`${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}参考数量超过上限`)
    }
    if (!saved || isDirty) await onSave(normalizedDraft(videoDraftSchema.parse(form.getValues())))
    for (const asset of assets) await references.attach(asset.id)
  }
  return <Popover open={parametersOpen} onOpenChange={setParametersOpen}><aside className="inspector-pane">
    <div className="pane-toolbar inspector-top-toolbar"><h2>生成设置</h2><div className="button-row inspector-top-actions">
      <PopoverTrigger asChild><Button variant="ghost" size="small" title="片段参数" aria-label="片段参数" disabled={saving || generation.pending}><FontAwesomeIcon icon={faGear} />片段参数</Button></PopoverTrigger>
      <span className={isDirty || !saved ? 'text-warning' : 'text-success'}><FontAwesomeIcon icon={isDirty || !saved ? faFloppyDisk : faCheck} /> {isDirty || !saved ? '未保存' : '已保存'}</span>
      {tab === 'video' && <><Button variant="outline" type="submit" form={formId} disabled={externalChanges || saving || generation.pending || importing || (saved && !isDirty)}><FontAwesomeIcon icon={faFloppyDisk} />{saving ? '保存中' : '保存草稿'}</Button>
          <Button disabled={externalChanges || saving || generation.pending || importing || !referencesKnown || Boolean(references.error)}
            onClick={() => { void form.handleSubmit((value) => generation.submit(normalizedDraft(value), onSave), revealParameterErrors)() }}><FontAwesomeIcon icon={faPlay} />{generation.pending ? '提交中' : '提交生成'}</Button></>}
    </div></div>
    {hasSpeechProvider && <div className="inspector-mode-switch"><Button variant="ghost" size="small" onClick={() => setTab(tab === 'video' ? 'dialogue' : 'video')}>{tab === 'video' ? `台词音频${dialogueDirty ? ' *' : ''}` : '返回视频生成'}</Button></div>}
    {tab === 'video' && generation.pending && <p className="inspector-submit-status muted" role="status"><FontAwesomeIcon icon={faTriangleExclamation} /> 正在上传或提交，请勿重复操作</p>}
    <form id={formId} className="inspector-form" style={tab === 'video' ? undefined : { display: 'none' }} onSubmit={form.handleSubmit(async (value) => {
      if (externalChanges) { onNotice('已有外部新版本，请先重新载入视频草稿；本地修改未被覆盖'); return }
      await onSave(normalizedDraft(value)).catch(() => undefined)
    }, revealParameterErrors)}>
      {externalChanges && <p className="field-error" role="alert">MCP 或其他窗口已更新草稿。本地修改已保留，保存和提交已暂停；请先用顶部重新载入按钮载入最新版本。</p>}
      <fieldset className="inspector-scroll video-editor-layout" disabled={saving || generation.pending}>
        <div className="video-title-row"><label htmlFor="video-title">视频名称</label><Input id="video-title" {...form.register('title')} /></div>
        {form.formState.errors.title && <p className="field-error">{form.formState.errors.title.message}</p>}
        <PromptEditor text={form.watch('prompt')} document={form.watch('promptDocument')} duration={form.watch('duration')} disabled={saving || generation.pending} references={references.data ?? []} busy={importing || generation.pending} onCheckStructure={checkStructure} onOpenLibrary={() => setPicker(true)}
          onOpenVoices={() => setVoicePicker(true)} referenceStatus={references.error ? 'error' : referencesKnown ? 'ready' : 'loading'}
          onChange={(text, document) => {
            form.setValue('prompt', text, { shouldDirty: true, shouldValidate: true })
            form.setValue('promptDocument', document, { shouldDirty: true, shouldValidate: true })
          }} onImport={(kind) => {
            importReferences(async () => {
              if (!saved || isDirty) await onSave(normalizedDraft(videoDraftSchema.parse(form.getValues())))
              await references.importFiles(kind)
            })
          }} onDropFiles={(files) => {
            if (!referencesKnown || references.error) { referenceError('参考素材尚未就绪，请载入后再拖入文件'); return }
            importReferences(() => references.dropFiles(files, projectId, async () => {
              await onSave(normalizedDraft(videoDraftSchema.parse(form.getValues())))
            }))
          }} onPasteImages={(files) => {
            importReferences(() => references.pasteImages(files, async () => {
              // 混贴文字在同一事件内更新表单，不能依赖上一帧的 isDirty。
              await onSave(normalizedDraft(videoDraftSchema.parse(form.getValues())))
            }))
          }} onReplace={(reference) => {
            if (externalChanges || importing || generation.pending) { referenceError('请先结束当前操作或载入最新草稿'); return }
            setReplacement(reference); setPicker(true)
          }} onRemove={async (reference) => {
            if (externalChanges) { referenceError('已有外部新版本，请先重新载入草稿再解除引用'); return }
            if (form.getValues('prompt').includes(reference.label)) { referenceError('请先移除提示词中的对应引用并保存'); return }
            if (!(await confirmAction(`解除「${reference.name}」的关联？已导入文件会保留。`))) return
            void references.remove(reference.id).then(() => { setError(''); onNotice('已解除素材关联，原文件仍保留') }).catch((failure: unknown) => referenceError(failure instanceof Error ? failure.message : '解除关联失败'))
          }} onReveal={(id) => { void references.reveal(id).catch((failure: unknown) => referenceError(failure instanceof Error ? failure.message : '无法定位素材')) }} />
        {(error || references.error) && <p className="field-error" role="alert">{error || references.error?.message}</p>}
        {(form.formState.errors.prompt || form.formState.errors.promptDocument) && <p className="field-error">{form.formState.errors.prompt?.message || form.formState.errors.promptDocument?.message}</p>}
        <PopoverContent className="video-parameters-popover" side="bottom" align="end" sideOffset={8} aria-label="片段参数">
          <div className="pane-toolbar"><h3>片段参数</h3><Button variant="ghost" size="icon" title="关闭片段参数" aria-label="关闭片段参数" onClick={() => setParametersOpen(false)}><FontAwesomeIcon icon={faXmark} /></Button></div>
          {/* 浮窗通过 Portal 渲染，需显式保留提交中的禁用保护。 */}
          <fieldset className="parameter-section" disabled={saving || generation.pending}>
          <div className="settings-grid">
            <label htmlFor="video-duration">时长<Input id="video-duration" type="number" min={4} max={15} {...form.register('duration', { valueAsNumber: true })} /><span className="unit">秒</span></label>
            <div className="parameter-field"><label htmlFor="video-aspect-ratio">画面比例</label>
              <Select value={aspectRatio} disabled={saving || generation.pending} onValueChange={(value) => form.setValue('aspectRatio', videoDraftSchema.shape.aspectRatio.parse(value), { shouldDirty: true, shouldValidate: true })}>
                <SelectTrigger id="video-aspect-ratio"><SelectValue /></SelectTrigger><SelectContent>{['16:9', '9:16', '1:1'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="parameter-field"><label htmlFor="video-resolution">分辨率</label>
              <Select value={resolution} disabled={saving || generation.pending} onValueChange={(value) => form.setValue('resolution', videoDraftSchema.shape.resolution.parse(value), { shouldDirty: true, shouldValidate: true })}>
                <SelectTrigger id="video-resolution"><SelectValue /></SelectTrigger><SelectContent>{['720P', '1080P'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          {(supportsCombat || form.watch('combatEnabled')) && <label className="check-field"><Checkbox checked={form.watch('combatEnabled') ?? false}
            disabled={!supportsCombat && !form.watch('combatEnabled') || saving || generation.pending}
            onCheckedChange={(checked) => form.setValue('combatEnabled', checked === true, { shouldDirty: true })} />武打增强（加速工作流）</label>}
          {form.formState.errors.duration && <p className="field-error">时长须为 4–15 秒</p>}
          <div className="parameter-field"><label htmlFor="video-shot-continuity">当前镜头</label>
            <Select value={form.watch('shotContinuity') ?? 'independent'} disabled={saving || generation.pending} onValueChange={(value) => form.setValue('shotContinuity', videoDraftSchema.shape.shotContinuity.parse(value), { shouldDirty: true, shouldValidate: true })}>
              <SelectTrigger id="video-shot-continuity"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="independent">独立镜头 / 切镜</SelectItem><SelectItem value="continuous">连续镜头 · 承接上一段</SelectItem>
              </SelectContent>
            </Select></div>
          <div className="parameter-field"><label htmlFor="video-next-transition">与下一段衔接</label>
            <Select value={form.watch('nextTransition') ?? 'cut'} disabled={saving || generation.pending} onValueChange={(value) => form.setValue('nextTransition', videoDraftSchema.shape.nextTransition.parse(value), { shouldDirty: true, shouldValidate: true })}>
              <SelectTrigger id="video-next-transition"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="cut">非连续镜头 / 切镜</SelectItem><SelectItem value="continuous">连续镜头</SelectItem>
              </SelectContent>
            </Select></div>
          {form.watch('nextTransition') === 'continuous' && <label htmlFor="continuity-tail-seconds">尾段参考时长（秒）
            <Input id="continuity-tail-seconds" type="number" min={1} max={5} value={form.watch('continuityTailSeconds') ?? 1}
              onChange={(event) => form.setValue('continuityTailSeconds', event.currentTarget.valueAsNumber, { shouldDirty: true, shouldValidate: true })} />
            {form.formState.errors.continuityTailSeconds && <span className="field-error">尾段时长须为 1–5 秒</span>}
          </label>}
          <fieldset className="instance-field"><legend>运行实例 · {mode === 'auto' ? '自动' : '手动'}{mode === 'auto' && !referencesKnown ? '（参考图数量待载入）' : ''}</legend>
            <label className="check-field"><Checkbox checked={mode === 'auto'} disabled={saving || generation.pending} onCheckedChange={(checked) => {
              // 退出自动模式时保留当前显示的档位，不跳回历史缓存值。
              if (checked !== true) form.setValue('instance', effectiveInstance, { shouldDirty: true })
              form.setValue('instanceMode', checked === true ? 'auto' : 'manual', { shouldDirty: true })
            }} />自动档位</label>
            <ToggleGroup type="single" value={effectiveInstance} aria-label="运行实例" disabled={saving || generation.pending} onValueChange={(value) => {
              if (!value) return
              form.setValue('instanceMode', 'manual', { shouldDirty: true })
              form.setValue('instance', videoDraftSchema.shape.instance.parse(value), { shouldDirty: true })
            }}>
              {([{ value: 'default', label: 'Lite' }, { value: 'plus', label: 'Plus' }, { value: 'ultra', label: 'Ultra' }] as const).map((item) =>
                <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}
            </ToggleGroup></fieldset>
          </fieldset>
        </PopoverContent>
      </fieldset>

    </form>
    {hasSpeechProvider && <div className="inspector-form" style={tab === 'dialogue' ? undefined : { display: 'none' }}>
      <DialogueProduction key={draft.id} projectId={projectId} draftId={draft.id} saved={saved} sourcePrompt={draft.prompt} sourceDirty={isDirty} onDirty={setDialogueDirty} />
    </div>}
    {voicePicker && <VoicePicker onClose={() => setVoicePicker(false)} onPick={async (assetId) => {
      if (externalChanges || saving || generation.pending || importingRef.current) throw new Error('请先保存或结束当前操作')
      if (!saved || isDirty) await onSave(normalizedDraft(videoDraftSchema.parse(form.getValues())))
      await references.attach(assetId)
      onNotice('已绑定公共音色，请在对白中使用对应 Audio 引用标签')
    }} />}
    {picker && <AssetPicker projectId={projectId} {...(replacement ? { requiredKind: replacement.kind, replacing: true } : { onPickMany: pickAssets })}
      onClose={() => { setPicker(false); setReplacement(null) }} onPick={(asset) => pickAssets([asset])} />}
  </aside></Popover>
}
