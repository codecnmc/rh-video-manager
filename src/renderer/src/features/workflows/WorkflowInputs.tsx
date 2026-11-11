import { useEffect, useState } from 'react'
import type { Workflow, WorkflowApplication } from '@contracts/workflows'
import type { Asset } from '@contracts/assets'
import type { StartWorkflowRun } from '@contracts/workflow-runs'
import { Button } from '@/components/ui/button'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { VoicePicker } from '@/features/voices'
import './workflow-inputs.css'
import type { RestoredWorkflowInput } from './restore-workflow-input'
import { workflowInputState } from './workflow-input-state'

export function WorkflowInputs({ workflow, initial, blocked = false, onBusy, onRun, onChooseMedia, onChooseVoice, onDirty }: { workflow: Workflow; initial?: RestoredWorkflowInput; blocked?: boolean; onBusy?: (busy: boolean) => void;
  onRun?: (values: StartWorkflowRun['values'], instance: StartWorkflowRun['instance']) => Promise<boolean | void>;
  onChooseMedia?: (key: string) => Promise<Asset | null>; onChooseVoice?: (id: string) => Promise<Asset>;
  onDirty?: (value: boolean) => void }) {
  const [values, setValues] = useState<StartWorkflowRun['values']>(() => initial?.values ?? {})
  const [names, setNames] = useState<Record<string, string>>(() => initial?.names ?? {})
  const [voiceField, setVoiceField] = useState<string | null>(null)
  const [instance, setInstance] = useState<StartWorkflowRun['instance']>(() => initial?.instance ?? 'default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = workflowInputState(workflow, values, instance)
  const [baseline, setBaseline] = useState(() => state)
  useEffect(() => { onDirty?.(state !== baseline) }, [state, baseline, onDirty])
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false) }, [busy, onBusy])
  if (!workflow.form?.fields.length) return <p className="muted">尚未识别到可编辑输入，请先检测线上工作流。</p>
  const configured = workflow.application?.fields ?? workflow.form.fields.map((field): WorkflowApplication['fields'][number] => ({
    key: field.key, label: field.title, visibility: 'advanced', control: field.type === 'text' ? 'singleline' : 'native', defaultValue: field.defaultValue
  }))
  const advanced = configured.filter((field) => field.visibility === 'advanced')
  const legacyFields = workflow.form.fields.some((field) => /^input-\d+$/.test(field.key))
  const bind = (key: string, asset: Asset) => {
    setValues((current) => ({ ...current, [key]: { assetId: asset.id, expectedUpdatedAt: asset.updatedAt } }))
    setNames((current) => ({ ...current, [key]: asset.name }))
  }
  const renderField = (setting: WorkflowApplication['fields'][number]) => {
    const field = workflow.form!.fields.find((item) => item.key === setting.key)
    if (!field) return null
    const key = field.key
    const value = values[key] ?? setting.defaultValue
    const id = `workflow-input-${workflow.id}-${field.key}`
    return <div className="parameter-field workflow-quick-field" key={key}><label htmlFor={id}>{setting.label}</label>
      {field.type === 'image' || field.type === 'audio' ? <div className="workflow-media-input"><div className="button-row"><Button id={id} variant="outline" disabled={!onChooseMedia} onClick={async () => {
        if (!onChooseMedia) return
        setBusy(true); setError('')
        try { const asset = await onChooseMedia(key); if (asset) bind(key, asset) }
        catch (failure) { setError(failure instanceof Error ? failure.message : '素材选择失败') } finally { setBusy(false) }
      }}>选择{field.type === 'image' ? '图片' : '音频'}</Button>{field.type === 'audio' && onChooseVoice && <Button variant="ghost" onClick={() => setVoiceField(key)}>公共音色</Button>}<span className="muted">{names[key] ?? '未选择'}</span></div>
        {typeof value === 'object' && (field.type === 'audio' ? <audio controls preload="none" aria-label={`试听 ${setting.label}`} src={`workbench-asset://library/${value.assetId}`} /> : <img alt={setting.label} src={`workbench-asset://library/${value.assetId}`} />)}</div>
        : field.type === 'boolean' ? <CheckboxField id={id} checked={value === true} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} />
          : field.type === 'number' ? <Input id={id} type="number" step="any" required value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value === '' ? '' : event.target.valueAsNumber }))} />
            : setting.control === 'multiline' ? <Textarea id={id} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
              : <Input id={id} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />}
    </div>
  }
  return <><form className="workflow-dynamic-fields" onSubmit={async (event) => {
    event.preventDefault()
    if (!onRun || busy || blocked || !workflow.form) return
    const inputs: StartWorkflowRun['values'] = {}
    for (const field of workflow.form.fields) {
      const setting = configured.find((item) => item.key === field.key)
      const value = setting?.visibility === 'fixed' ? setting.defaultValue : values[field.key] ?? setting?.defaultValue ?? field.defaultValue
      if ((field.type === 'image' || field.type === 'audio') && typeof value !== 'object') { setError('请选择所有图片或音频参考素材（含高级设置中的素材）'); return }
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) { setError('请填写有效的数值参数'); return }
      inputs[field.key] = value
    }
    setBusy(true); setError('')
    try { if (await onRun(inputs, instance) !== false) { setBaseline(state); onDirty?.(false) } } catch (failure) { setError(failure instanceof Error ? failure.message : '运行失败') } finally { setBusy(false) }
  }}>{initial?.warnings.length ? <div className="field-error" role="alert">{initial.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}{legacyFields && <p className="field-error" role="alert">字段识别已升级，请先点击“重新检测”，再复核应用配置。</p>}<fieldset disabled={blocked || busy || legacyFields || workflow.application?.needsReview}>
    {configured.filter((field) => field.visibility === 'common').map(renderField)}
    {advanced.length > 0 && <details className="workflow-advanced"><summary>高级设置 <span className="muted">{advanced.length} 项</span></summary><div className="workflow-advanced-fields">{advanced.map(renderField)}</div></details>}
    {onRun && <div className="workflow-run-actions"><label className="workflow-instance">运行实例<SelectField aria-label="运行实例" value={instance} onChange={(event) => setInstance(event.target.value as StartWorkflowRun['instance'])}><SelectOption value="default">Lite</SelectOption><SelectOption value="plus">Plus</SelectOption><SelectOption value="ultra">Ultra</SelectOption></SelectField></label>
      <Button type="submit" disabled={!workflow.enabled || Boolean(workflow.error)}>{busy ? '处理中' : '确认并运行'}</Button></div>}
  </fieldset>{error && <p className="field-error" role="alert">{error}</p>}{!onRun && <p className="muted">当前为输入表单预览，不会提交生成。</p>}</form>
    {voiceField && onChooseVoice && <VoicePicker onClose={() => setVoiceField(null)} onPick={async (id) => { bind(voiceField, await onChooseVoice(id)) }} />}
  </>
}
