import { SelectOption } from '@/components/ui/select-field'
import { SuggestionInput } from '@/components/ui/suggestion-input'
import { confirmAction } from '@/components/ui/confirmation'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faFloppyDisk, faPlay, faStop, faCheck, faFileImport, faLink, faRotateRight, faBookmark, faImages } from '@fortawesome/free-solid-svg-icons'
import { dialoguePlanSchema, dialogueImportSchema, type DialogueLine, type DialoguePlan, type DialogueTake } from '@contracts/production'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { AssetPicker } from '@/features/assets'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { useProduction } from './use-production'
import './production.css'

const statusNames: Record<DialogueTake['status'], string> = { queued: '排队', running: '生成中', cancelling: '取消中',
  succeeded: '已生成', failed: '失败', cancelled: '已取消', interrupted: '已中断，需核对' }
const blankLine = (): DialogueLine => ({ id: crypto.randomUUID(), character: '', text: '', delivery: '', speed: 1,
  extensionId: '', providerId: '', voiceId: '', language: 'zh', startMs: 0 })

export function DialogueProduction({ projectId, draftId, saved, sourcePrompt, sourceDirty, onDirty }: {
  projectId: string; draftId: string; saved: boolean; sourcePrompt: string; sourceDirty: boolean; onDirty: (dirty: boolean) => void
}) {
  const production = useProduction({ projectId, draftId }, saved)
  const form = useForm<DialoguePlan>({ resolver: zodResolver(dialoguePlanSchema),
    defaultValues: { projectId, draftId, revision: 0, enabled: false, lines: [] } })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [picker, setPicker] = useState(false)
  const [json, setJson] = useState('')
  const [voices, setVoices] = useState<Record<string, { id: string; name: string; language: string }[]>>({})
  const dirty = form.formState.isDirty
  const plan = form.watch()
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { if (production.data && !dirty) form.reset(production.data.plan) }, [production.data?.plan, dirty, form])
  const capabilities = production.capabilities.data ?? []
  const takes = production.data?.takes ?? []
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败') }
    finally { setBusy(false) }
  }
  function importLines(value: string): void {
    const imported = dialogueImportSchema.parse(JSON.parse(value) as unknown)
    if (fields.length + imported.length > 200) throw new Error('最多保留 200 句台词')
    append(imported.map((line) => {
      const binding = production.data?.voices.bindings.find((item) => item.character === line.character.trim())
      return { ...blankLine(), ...binding, ...line }
    }))
  }
  if (!saved) return <div className="dialogue-empty">请先保存视频草稿</div>
  return <form className="dialogue-production" onSubmit={form.handleSubmit((value) => perform(async () => form.reset(await production.save(value))))}>
    <div className="dialogue-toolbar">
      <label className="check-field"><CheckboxField  disabled={busy || !production.data} checked={form.watch('enabled')} onChange={(event) => form.setValue('enabled', event.target.checked, { shouldDirty: true })} />台词音频</label>
      <span className="muted">{dirty ? '未保存' : `修订 ${plan.revision}`}</span>
      <Button type="submit" variant="outline" size="small" disabled={busy || !production.data || !dirty}><FontAwesomeIcon icon={faFloppyDisk} />保存配置</Button>
      <Button variant="ghost" size="icon" title="重新载入台词配置" aria-label="重新载入台词配置" disabled={busy} onClick={async () => {
        if (dirty && !(await confirmAction('放弃未保存的台词配置并重新载入？'))) return
        void perform(async () => { const result = await production.refetch(); if (result.data) form.reset(result.data.plan) })
      }}><FontAwesomeIcon icon={faRotateRight} /></Button>
    </div>
    <div className="dialogue-scroll">
      {(error || production.error || production.capabilities.error) && <p className="field-error" role="alert">{error || production.error?.message || production.capabilities.error?.message}</p>}
      {Object.keys(form.formState.errors).length > 0 && <p className="field-error" role="alert">请检查台词、速度和时间字段</p>}
      {!production.data && <p className="muted">{production.isFetching ? '载入中' : '配置不可用'}</p>}
      {capabilities.length === 0 && production.capabilities.data && <p className="muted">暂无已安装的语音引擎</p>}
      <fieldset disabled={busy || !production.data} className="dialogue-fields">
        {fields.map((field, index) => {
          const line = plan.lines[index]!
          const capability = capabilities.find((item) => item.extensionId === line.extensionId && item.provider.id === line.providerId)
          const engineKey = `${line.extensionId}/${line.providerId}`
          const voiceKey = `${engineKey}/${capability?.configurationKey ?? ''}`
          const availableVoices = voices[voiceKey] ?? []
          const lineTakes = takes.filter((take) => take.line.id === line.id)
          const running = lineTakes.some((take) => ['queued', 'running', 'cancelling'].includes(take.status))
          return <section className="dialogue-line" key={field.id}>
            <div className="dialogue-line-heading"><h3>台词 {index + 1}</h3><Button size="icon" variant="ghost" title="删除台词配置" aria-label="删除台词配置" onClick={async () => {
              if ((await confirmAction('删除这句台词配置？历史候选音频仍会保留。'))) remove(index)
            }}><FontAwesomeIcon icon={faTrash} /></Button></div>
            <div className="dialogue-grid"><label>角色<SuggestionInput maxLength={100} value={line.character} options={production.data?.voices.bindings.map((binding) => binding.character) ?? []}
              onSelectValue={(value) => {
                form.setValue(`lines.${index}.character`, value, { shouldDirty: true })
                const binding = production.data?.voices.bindings.find((item) => item.character === value)
                if (binding && !form.getValues(`lines.${index}.voiceId`)) {
                  for (const key of ['extensionId', 'providerId', 'voiceId', 'language', 'speed'] as const) form.setValue(`lines.${index}.${key}`, binding[key], { shouldDirty: true })
                }
              }} {...form.register(`lines.${index}.character`, { onBlur: () => {
              const current = form.getValues(`lines.${index}`)
              const binding = production.data?.voices.bindings.find((item) => item.character === current.character.trim())
              if (binding && !current.voiceId) {
                for (const key of ['extensionId', 'providerId', 'voiceId', 'language', 'speed'] as const) form.setValue(`lines.${index}.${key}`, binding[key], { shouldDirty: true })
              }
            } })} /></label>
              <label>起始时间（毫秒）<Input type="number" min={0} max={3600000} step={100} {...form.register(`lines.${index}.startMs`, { valueAsNumber: true })} /></label></div>
            <label>台词<Textarea rows={3} maxLength={5000} {...form.register(`lines.${index}.text`)} /></label>
            {capability?.provider.maxTextLength && <p className={line.text.length > capability.provider.maxTextLength ? 'field-error' : 'muted'}>{line.text.length} / {capability.provider.maxTextLength} 字</p>}
            <label>引擎<SelectField value={capability ? engineKey : ''} onChange={(event) => {
              const selected = capabilities.find((item) => `${item.extensionId}/${item.provider.id}` === event.target.value)
              form.setValue(`lines.${index}.extensionId`, selected?.extensionId ?? '', { shouldDirty: true })
              form.setValue(`lines.${index}.providerId`, selected?.provider.id ?? '', { shouldDirty: true })
              form.setValue(`lines.${index}.voiceId`, '', { shouldDirty: true })
            }}><SelectOption value="">选择引擎</SelectOption>{capabilities.map((item) => <SelectOption key={`${item.extensionId}/${item.provider.id}`} value={`${item.extensionId}/${item.provider.id}`} disabled={!item.available}>
              {item.provider.name} · {item.provider.runtime === 'local' ? '本地' : '云端'}{item.reason ? ` · ${item.reason}` : ''}</SelectOption>)}</SelectField></label>
            {line.extensionId && !capability && <p className="field-error">原引擎已卸载或不可用</p>}
            <div className="dialogue-voice-row"><label>音色<SelectField value={line.voiceId} disabled={!availableVoices.length} onChange={(event) => {
              const voice = availableVoices.find((item) => item.id === event.target.value)
              form.setValue(`lines.${index}.voiceId`, event.target.value, { shouldDirty: true })
              if (voice?.language) form.setValue(`lines.${index}.language`, voice.language, { shouldDirty: true })
            }}><SelectOption value={line.voiceId && !availableVoices.some((voice) => voice.id === line.voiceId) ? line.voiceId : ''}>
                {line.voiceId && !availableVoices.some((voice) => voice.id === line.voiceId) ? line.voiceId : '选择音色'}</SelectOption>
              {availableVoices.map((voice) => <SelectOption key={voice.id} value={voice.id}>{voice.name}</SelectOption>)}</SelectField></label>
              <Button variant="outline" size="icon" title="载入音色" aria-label="载入音色" disabled={!capability?.available} onClick={() => void perform(async () => {
                setVoices((current) => ({ ...current, [voiceKey]: [] }))
                const result = unwrap(await desktop().listExtensionVoices(line.extensionId, line.providerId))
                setVoices((current) => ({ ...current, [voiceKey]: result }))
              })}><FontAwesomeIcon icon={faRotateRight} /></Button>
              <Button variant="outline" size="icon" title="应用音色到同角色台词" aria-label="应用音色到同角色台词" disabled={!line.character.trim() || !line.voiceId} onClick={() => {
                plan.lines.forEach((item, row) => {
                  if (row !== index && item.character.trim() === line.character.trim()) {
                    for (const key of ['extensionId', 'providerId', 'voiceId', 'language', 'speed'] as const) form.setValue(`lines.${row}.${key}`, line[key], { shouldDirty: true })
                  }
                })
              }}><FontAwesomeIcon icon={faLink} /></Button></div>
            <div className="dialogue-line-actions"><Button variant="ghost" size="small" disabled={!line.character.trim() || !line.voiceId || !line.extensionId || !line.providerId}
              onClick={() => void perform(() => production.saveVoice({ character: line.character.trim(), extensionId: line.extensionId, providerId: line.providerId,
                voiceId: line.voiceId, language: line.language, speed: line.speed }, production.data?.voices.revision ?? 0))}>
              <FontAwesomeIcon icon={faBookmark} />设为项目角色音色</Button></div>
            <div className="dialogue-grid"><label>语速<Input type="number" min={0.5} max={2} step={0.05} {...form.register(`lines.${index}.speed`, { valueAsNumber: true })} /></label>
              <label>语言<Input maxLength={40} {...form.register(`lines.${index}.language`)} /></label></div>
            <label>语气描述{capability && !capability.provider.capabilities.emotion && <span className="muted"> · 此引擎不支持</span>}
              <Textarea rows={2} maxLength={1000} {...form.register(`lines.${index}.delivery`)} /></label>
            {line.delivery.trim() && capability && !capability.provider.capabilities.emotion && <p className="field-error">语气描述不会被忽略，请更换引擎或清空后生成</p>}
            <div className="dialogue-line-actions"><span className="muted">{lineTakes.length} 个候选</span>
              <Button size="small" disabled={dirty || sourceDirty || !plan.enabled || !capability?.available || !line.voiceId || !line.text.trim() || running || line.text.length > (capability.provider.maxTextLength ?? 5000) || (!!line.delivery.trim() && !capability.provider.capabilities.emotion)}
                title={dirty || sourceDirty ? '请先保存草稿和台词配置' : '独立生成这句台词'} onClick={() => void perform(() => production.generate(line.id, plan.revision))}>
                <FontAwesomeIcon icon={faPlay} />{running ? '生成中' : lineTakes.length ? '再生成' : '生成台词'}</Button></div>
          </section>
        })}
        <div className="button-row"><Button variant="outline" size="small" disabled={fields.length >= 200} onClick={() => append(blankLine())}><FontAwesomeIcon icon={faPlus} />添加台词</Button>
          <Button variant="outline" size="small" onClick={() => { setJson(''); setError(''); setImporting(true) }}><FontAwesomeIcon icon={faFileImport} />导入台词</Button></div>
        <div className="button-row"><Button variant="ghost" size="small" onClick={() => setPicker(true)}><FontAwesomeIcon icon={faImages} />从素材库导入台词</Button></div>
      </fieldset>
      <section className="dialogue-history"><h3>候选音频 · {takes.length}</h3>
        {takes.length === 0 && <p className="muted">暂无生成记录</p>}
        {takes.map((take) => {
          const provider = capabilities.find((item) => item.extensionId === take.line.extensionId && item.provider.id === take.line.providerId)
          const stale = take.planRevision !== plan.revision || take.sourcePrompt !== sourcePrompt || dirty || sourceDirty ||
            provider?.configurationKey !== take.configurationKey || provider?.version !== take.providerVersion
          return <article className="dialogue-take" key={take.id}>
            <div className="dialogue-take-heading"><strong>{take.line.character || '台词'}</strong><span>{statusNames[take.status]}{take.adopted ? ' · 已采用' : ''}{stale ? ' · 旧版输入' : ''}</span></div>
            <p>{take.line.text}</p><span className="muted">{take.createdAt.replace('T', ' ').slice(0, 19)} · {take.line.voiceId} · {take.durationMs ? `${(take.durationMs / 1000).toFixed(2)} 秒` : `修订 ${take.planRevision}`}</span>
            {take.error && <p className="field-error">{take.error}</p>}
            {take.assetId && <audio aria-label={`${take.line.character || '台词'}候选音频`} src={`workbench-asset://library/${take.assetId}`} controls preload="none" />}
            <div className="dialogue-line-actions">
              {['queued', 'running', 'cancelling'].includes(take.status) && <Button variant="outline" size="small" disabled={busy || take.status === 'cancelling'} onClick={() => void perform(() => production.cancel(take.id))}><FontAwesomeIcon icon={faStop} />取消</Button>}
              {take.status === 'succeeded' && <Button variant={take.adopted && !stale ? 'default' : 'outline'} size="small" disabled={busy || stale || take.adopted} onClick={() => void perform(() => production.adopt(take.id, plan.revision))}><FontAwesomeIcon icon={faCheck} />{take.adopted ? '已采用' : '采用此候选'}</Button>}
            </div>
          </article>
        })}
      </section>
    </div>
    {importing && <Dialog title="导入台词" onClose={() => setImporting(false)}>
      <label className="field-label" htmlFor="dialogue-json">台词 JSON</label><Textarea id="dialogue-json" rows={12} value={json} onChange={(event) => setJson(event.target.value)} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button variant="outline" onClick={() => setImporting(false)}>取消</Button><Button onClick={() => {
        try {
          importLines(json)
          setError(''); setImporting(false)
        } catch { setError('台词 JSON 格式不正确或超过数量上限') }
      }}><FontAwesomeIcon icon={faFileImport} />导入</Button></div>
    </Dialog>}
    {picker && <AssetPicker projectId={projectId} onClose={() => setPicker(false)} onPick={async (asset) => {
      if (asset.kind !== 'prompt') throw new Error('请选择包含台词 JSON 的提示词素材')
      try { importLines(asset.prompt); setError('') }
      catch { throw new Error('所选素材不是有效台词 JSON，未导入') }
    }} />}
  </form>
}
