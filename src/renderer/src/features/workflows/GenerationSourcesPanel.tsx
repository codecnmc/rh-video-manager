import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { routingSettingsSchema, type RoutingSettings, type GenerationTarget } from '@contracts/generation-sources'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { confirmAction } from '@/components/ui/confirmation'
import { useGenerationSources } from './use-generation-sources'
import { useWorkflows } from './use-workflows'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faArrowLeft, faArrowUp, faArrowDown, faTrash, faRotateRight, faFloppyDisk, faServer, faRoute, faFileImport, faPlug, faCircleNotch } from '@fortawesome/free-solid-svg-icons'

export function GenerationSourcesPanel({ onDirty, onNotice, onBack }: { onDirty: (dirty: boolean) => void; onNotice: (message: string) => void; onBack: () => void }) {
  const sources = useGenerationSources()
  const workflows = useWorkflows()
  const form = useForm<RoutingSettings>({ resolver: zodResolver(routingSettingsSchema), defaultValues: { revision: 0, sources: [], rules: [] } })
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Record<string, { text: string; ready: boolean } | undefined>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [panelError, setPanelError] = useState('')
  useEffect(() => { if (sources.data && !form.formState.isDirty) form.reset(sources.data) }, [sources.data, form])
  useEffect(() => { onDirty(form.formState.isDirty) }, [form.formState.isDirty, onDirty])
  const local = form.watch('sources')
  const rules = form.watch('rules')
  const remote = (workflows.data ?? []).filter((item) => item.provider !== 'comfyui' && item.enabled && (item.kind ?? 'video') === 'video' && item.accountId)
  const videoTargets = local.flatMap((source) => (source.workflows ?? []).filter((item) => item.kind === 'video').map((item) => ({ source, workflow: item })))
  const targetValue = (target: GenerationTarget) => target.kind === 'comfyui' ? `comfyui:${target.sourceId}:${target.workflowId ?? videoTargets.find((item) => item.source.id === target.sourceId)?.workflow.id ?? ''}` : target.workflowConfigId ? `rh:${target.workflowConfigId}` : 'rh'
  function parseTarget(value: string): GenerationTarget {
    const [, sourceId, workflowId] = value.split(':')
    return value.startsWith('comfyui:') && sourceId && workflowId ? { kind: 'comfyui', sourceId, workflowId } : value.startsWith('rh:') ? { kind: 'rh', workflowConfigId: value.slice(3) } : { kind: 'rh' }
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setPanelError('')
    try { await action() } catch (error) { const message = error instanceof Error ? error.message : '操作失败'; setPanelError(message); onNotice(message) } finally { setBusy(false) }
  }
  function moveRule(index: number, offset: number) {
    const next = [...rules]
    const destination = index + offset
    if (destination < 0 || destination >= next.length) return
    const moving = next[index]!
    next[index] = next[destination]!
    next[destination] = moving
    form.setValue('rules', next, { shouldDirty: true })
  }
  const disabled = busy || sources.isPending || sources.isError
  return <section className="management-page generation-sources-page">
    <header className="generation-sources-toolbar">
      <div className="generation-sources-title"><Button variant="ghost" size="icon" title="返回工作流" aria-label="返回工作流" disabled={busy} onClick={async () => {
        if (form.formState.isDirty && !await confirmAction('放弃生成来源与路由的未保存修改？')) return
        onDirty(false); onBack()
      }}><FontAwesomeIcon icon={faArrowLeft} /></Button><div><h2>生成来源与路由</h2><p>管理本地连接，按需分配生成任务</p></div></div>
      <div className="button-row"><span className={`generation-save-state ${form.formState.isDirty ? 'is-dirty' : ''}`}>{sources.isPending ? '正在载入' : sources.isError ? '载入失败' : form.formState.isDirty ? '有未保存修改' : '设置已保存'}</span>
        <Button variant="outline" disabled={busy || sources.isPending} onClick={async () => {
          if (form.formState.isDirty && !await confirmAction('丢弃当前修改并重新载入设置？')) return
          await perform(async () => { const result = await sources.refetch(); if (result.data) { form.reset(result.data); setReport({}) } })
        }}><FontAwesomeIcon icon={faRotateRight} />重新载入</Button>
        <Button disabled={disabled || !form.formState.isDirty} onClick={() => void form.handleSubmit((input) => perform(async () => {
          const saved = await sources.save(input); form.reset(saved); onNotice('生成来源和路由已保存')
        }), () => {
          const result = routingSettingsSchema.safeParse(form.getValues())
          const issue = result.success ? undefined : result.error.issues[0]
          const labels: Record<string, string> = { sources: '连接', workflows: '工作流', name: '名称', address: '服务地址', workflow: 'JSON 文件', rules: '规则', target: '目标来源' }
          setPanelError(`${issue?.path.map((part) => typeof part === 'number' ? `第 ${part + 1} 项` : labels[String(part)] ?? String(part)).join(' · ') ?? '设置'}：${issue?.message ?? '请检查输入'}`)
        })()}><FontAwesomeIcon icon={faFloppyDisk} />保存设置</Button>
      </div>
    </header>
    {(sources.error || workflows.error) && <p className="field-error" role="alert">{sources.error?.message || workflows.error?.message}</p>}
    {panelError && <p className="generation-form-error" role="alert">{panelError}</p>}
    <form className="generation-sources-form" onSubmit={(event) => event.preventDefault()}>
      <fieldset className="generation-sources-layout" disabled={disabled}>
        <section className="generation-config-section" aria-labelledby="generation-connections-heading">
          <div className="generation-section-heading"><div><h3 id="generation-connections-heading"><FontAwesomeIcon icon={faServer} />ComfyUI 来源<span className="generation-count">{local.length}</span></h3><p>连接本机或局域网实例，指定后在该实例排队。</p></div>
            <Button variant="outline" size="small" onClick={() => form.setValue('sources', [...local, { id: crypto.randomUUID(), name: '', address: 'http://127.0.0.1:8188', enabled: true, workflows: [] }], { shouldDirty: true })}><FontAwesomeIcon icon={faPlus} />添加连接</Button></div>
          <div className="generation-source-list">
            {!local.length && <div className="generation-empty"><FontAwesomeIcon icon={faServer} /><strong>尚未添加 ComfyUI</strong><p>一个连接可管理多个工作流，<br />支持视频、声音克隆与音色设计。</p></div>}
            {local.map((source, index) => <article key={source.id} className={`generation-source-card ${!source.enabled ? 'is-disabled' : ''}`}>
              <div className="generation-source-card-heading"><strong>{source.name || '新来源'}</strong><div className="button-row"><label className="check-field"><CheckboxField checked={source.enabled} onChange={(event) => form.setValue(`sources.${index}.enabled`, event.target.checked, { shouldDirty: true })} />启用</label>
                <Button variant="ghost" size="icon" className="generation-remove" title="移除来源" aria-label={`移除来源 ${source.name || index + 1}`} onClick={async () => {
                  if (!await confirmAction(`移除 ComfyUI 来源「${source.name}」及引用它的路由规则？`)) return
                  form.setValue('sources', local.filter((item) => item.id !== source.id), { shouldDirty: true })
                  form.setValue('rules', rules.filter((rule) => rule.target.kind !== 'comfyui' || rule.target.sourceId !== source.id), { shouldDirty: true })
                }}><FontAwesomeIcon icon={faTrash} /></Button></div></div>
              <div className="generation-source-fields"><label htmlFor={`source-name-${source.id}`}>名称<Input id={`source-name-${source.id}`} placeholder="例如：本机 H3" {...form.register(`sources.${index}.name`)} /></label>
                <label htmlFor={`source-address-${source.id}`}>服务地址<Input id={`source-address-${source.id}`} placeholder="http://127.0.0.1:8188" {...form.register(`sources.${index}.address`)} onChange={(event) => {
                  form.setValue(`sources.${index}.address`, event.target.value, { shouldDirty: true }); setReport((previous) => ({ ...previous, [source.id]: undefined }))
                }} /></label></div>
              {(form.formState.errors.sources?.[index]?.name || form.formState.errors.sources?.[index]?.address) && <p className="field-error">{form.formState.errors.sources?.[index]?.name?.message || form.formState.errors.sources?.[index]?.address?.message}</p>}
              <div className="generation-local-workflows"><div className="generation-local-workflows-heading"><strong>工作流 · {source.workflows?.length ?? 0}</strong><Button variant="ghost" size="small" onClick={() => void perform(async () => {
                const json = await sources.importWorkflow()
                if (json !== null) form.setValue(`sources.${index}.workflows`, [...(source.workflows ?? []), { id: crypto.randomUUID(), name: `工作流 ${(source.workflows?.length ?? 0) + 1}`, kind: 'video', purpose: 'video', enabled: true, workflow: json }], { shouldDirty: true })
              })}><FontAwesomeIcon icon={faPlus} />导入工作流</Button></div>
              <p className="muted">请在 ComfyUI 中导出 API 格式。普通保存的画布 JSON 不能直接执行。</p>
              {!source.workflows?.length && <p className="muted">可以先保存地址、测试连接，再添加工作流。</p>}
              {(source.workflows ?? []).map((definition, workflowIndex) => <div className="generation-local-workflow" key={definition.id}>
                <label htmlFor={`local-workflow-name-${definition.id}`}>工作流名称<Input id={`local-workflow-name-${definition.id}`} {...form.register(`sources.${index}.workflows.${workflowIndex}.name`)} /></label>
                <label htmlFor={`local-workflow-kind-${definition.id}`}>用途<SelectField id={`local-workflow-kind-${definition.id}`} value={definition.purpose ?? (definition.kind === 'video' ? 'video' : 'audio')} onChange={(event) => {
                  const purpose = event.target.value
                  if (purpose !== 'video') return
                  form.setValue(`sources.${index}.workflows.${workflowIndex}.purpose`, purpose, { shouldDirty: true })
                  form.setValue(`sources.${index}.workflows.${workflowIndex}.kind`, 'video', { shouldDirty: true })
                }}><SelectOption value="video">视频 · H3 全能参考</SelectOption><SelectOption value="voice-clone" disabled>声音克隆（暂不可选）</SelectOption><SelectOption value="voice-design" disabled>音色设计（暂不可选）</SelectOption><SelectOption value="audio" disabled>其他声音工作流（暂不可选）</SelectOption></SelectField></label>
                <div className="generation-workflow-file"><FontAwesomeIcon icon={faFileImport} /><div><strong>API 工作流 JSON</strong><span>{definition.checkedAt ? '已检测 · 在工作流列表中打开' : '保存后可在工作流列表检测并打开'}</span></div></div>
                {form.formState.errors.sources?.[index]?.workflows?.[workflowIndex]?.name && <p className="field-error">请填写该工作流名称</p>}
                <div className="generation-local-workflow-actions"><label className="check-field"><CheckboxField checked={definition.enabled} onChange={(event) => form.setValue(`sources.${index}.workflows.${workflowIndex}.enabled`, event.target.checked, { shouldDirty: true })} />启用</label><div className="button-row"><Button variant="ghost" size="small" onClick={() => void perform(async () => {
                  const json = await sources.importWorkflow()
                  if (json !== null) form.setValue(`sources.${index}.workflows.${workflowIndex}.workflow`, json, { shouldDirty: true })
                })}>更换文件</Button><Button variant="ghost" size="icon" className="generation-remove" title="移除工作流" aria-label={`移除工作流 ${definition.name}`} onClick={async () => {
                  if (!await confirmAction(`移除工作流「${definition.name}」及其路由规则？`)) return
                  form.setValue(`sources.${index}.workflows`, source.workflows?.filter((item) => item.id !== definition.id) ?? [], { shouldDirty: true })
                  form.setValue('rules', rules.filter((rule) => rule.target.kind !== 'comfyui' || rule.target.workflowId !== definition.id), { shouldDirty: true })
                }}><FontAwesomeIcon icon={faTrash} /></Button></div></div>
              </div>)}</div>
              <div className="generation-source-card-footer"><span className="muted">连接检测不会生成视频</span><Button variant="outline" size="small" onClick={() => void perform(async () => {
                setTestingId(source.id)
                try {
                  const result = await sources.test(source)
                  setReport((previous) => ({ ...previous, [source.id]: { ready: result.http && result.websocket && !result.missingNodes.length, text: `${result.message}${result.missingNodes.length ? `：${result.missingNodes.join('、')}` : ''}` } }))
                } catch (error) {
                  setReport((previous) => ({ ...previous, [source.id]: { ready: false, text: error instanceof Error ? error.message : '连接检测失败' } }))
                } finally { setTestingId(null) }
              })}><FontAwesomeIcon icon={testingId === source.id ? faCircleNotch : faPlug} spin={testingId === source.id} />{testingId === source.id ? '检测中' : '测试连接'}</Button></div>
              {report[source.id] && <p className={`generation-connection-result ${report[source.id]?.ready ? 'is-ready' : 'needs-attention'}`} role="status">{report[source.id]?.text}</p>}
            </article>)}
          </div>
        </section>
        <section className="generation-config-section generation-rules-section" aria-labelledby="generation-rules-heading">
          <div className="generation-section-heading"><div><h3 id="generation-rules-heading"><FontAwesomeIcon icon={faRoute} />自动路由规则<span className="generation-count">{rules.length}</span></h3><p>按顺序匹配，第一条命中的规则生效。</p></div><Button variant="outline" size="small" onClick={() => form.setValue('rules', [...rules, { id: crypto.randomUUID(), name: `规则 ${rules.length + 1}`, enabled: true, resolution: 'all', target: { kind: 'rh' } }], { shouldDirty: true })}><FontAwesomeIcon icon={faPlus} />添加规则</Button></div>
          <div className="generation-rule-list">
            {!rules.length && <div className="generation-empty"><FontAwesomeIcon icon={faRoute} /><strong>默认使用 RunningHub</strong><p>添加规则后，可将不同分辨率的任务<br />分配给 ComfyUI 或指定 RH 工作流。</p></div>}
            {rules.map((rule, index) => <div key={rule.id} className={`generation-rule-row ${!rule.enabled ? 'is-disabled' : ''}`}>
              <span className="generation-rule-order" title={`优先级 ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
              <label className="generation-rule-name" htmlFor={`rule-name-${rule.id}`}>规则名称<Input id={`rule-name-${rule.id}`} {...form.register(`rules.${index}.name`)} /></label>
              <label className="generation-rule-resolution" htmlFor={`rule-resolution-${rule.id}`}>分辨率<SelectField id={`rule-resolution-${rule.id}`} value={rule.resolution} onChange={(event) => form.setValue(`rules.${index}.resolution`, routingSettingsSchema.shape.rules.element.shape.resolution.parse(event.target.value), { shouldDirty: true })}>{['all', '480P', '720P', '1080P'].map((value) => <SelectOption key={value} value={value}>{value === 'all' ? '全部分辨率' : value}</SelectOption>)}</SelectField></label>
              <label className="generation-rule-target" htmlFor={`rule-target-${rule.id}`}>目标工作流<SelectField id={`rule-target-${rule.id}`} value={targetValue(rule.target)} onChange={(event) => form.setValue(`rules.${index}.target`, parseTarget(event.target.value), { shouldDirty: true })}><SelectOption value="rh">RH · 自动选择账号</SelectOption>{remote.map((item) => <SelectOption key={item.id} value={`rh:${item.id}`}>RH · {item.name}</SelectOption>)}{videoTargets.map(({ source: owner, workflow: definition }) => <SelectOption key={definition.id} value={`comfyui:${owner.id}:${definition.id}`}>ComfyUI · {owner.name} / {definition.name}{!owner.enabled || !definition.enabled ? '（已停用）' : ''}</SelectOption>)}</SelectField></label>
              <div className="generation-rule-actions"><label className="check-field"><CheckboxField aria-label={`启用规则 ${rule.name || index + 1}`} checked={rule.enabled} onChange={(event) => form.setValue(`rules.${index}.enabled`, event.target.checked, { shouldDirty: true })} />启用</label><div className="button-row">
                <Button variant="ghost" size="icon" disabled={index === 0} title="提高优先级" aria-label={`上移规则 ${index + 1}`} onClick={() => moveRule(index, -1)}><FontAwesomeIcon icon={faArrowUp} /></Button>
                <Button variant="ghost" size="icon" disabled={index === rules.length - 1} title="降低优先级" aria-label={`下移规则 ${index + 1}`} onClick={() => moveRule(index, 1)}><FontAwesomeIcon icon={faArrowDown} /></Button>
                <Button variant="ghost" size="icon" className="generation-remove" title="移除规则" aria-label={`移除规则 ${rule.name || index + 1}`} onClick={() => form.setValue('rules', rules.filter((item) => item.id !== rule.id), { shouldDirty: true })}><FontAwesomeIcon icon={faTrash} /></Button></div></div>
              {form.formState.errors.rules?.[index]?.name && <p className="field-error generation-rule-error">{form.formState.errors.rules?.[index]?.name?.message}</p>}
            </div>)}
          </div>
          <div className="generation-routing-summary"><strong>视频路由顺序</strong><p><span>指定工作流</span><span>匹配规则</span><span>默认 RH</span></p><small>命中 ComfyUI 后，实例繁忙时继续排队；后续规则仅匹配前面未命中的任务。声音克隆、音色设计在工作流列表中分别打开运行。</small></div>
        </section>
      </fieldset>
    </form>
  </section>
}
