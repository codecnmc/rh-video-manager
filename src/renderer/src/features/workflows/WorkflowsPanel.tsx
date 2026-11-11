import { WorkflowWorkspace } from './WorkflowWorkspace'
import { WorkflowHistory } from './WorkflowHistory'
import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select-field'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash, faMagnifyingGlass, faStar, faCheck, faDownload } from '@fortawesome/free-solid-svg-icons'
import { saveWorkflowSchema, type SaveWorkflow, type Workflow } from '@contracts/workflows'
import type { Account } from '@contracts/accounts'
import { Button } from '@/components/ui/button'
import { useAccounts } from '@/features/accounts'
import { useWorkflows } from './use-workflows'

function WorkflowForm({ workflow, accountId, accounts, onSave, onClose, onDirty }: {
  workflow: Workflow | null; accountId: string | undefined; accounts: Account[]
  onSave: (input: SaveWorkflow) => Promise<unknown>; onClose: () => void; onDirty: (value: boolean) => void
}) {
  const form = useForm<SaveWorkflow>({ resolver: zodResolver(saveWorkflowSchema), defaultValues: {
    kind: workflow?.kind ?? 'video', id: workflow?.id ?? null, accountId: accountId ?? workflow?.accountId ?? '', name: workflow?.name ?? '',
    workflowId: workflow?.workflowId ?? '', enabled: workflow?.enabled ?? true, isDefault: workflow?.isDefault ?? false
  } })
  const [error, setError] = useState('')
  useEffect(() => { onDirty(form.formState.isDirty) }, [form.formState.isDirty, onDirty])
  return <form className="management-form" onSubmit={form.handleSubmit(async (input) => {
    try { await onSave(input); onDirty(false); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') }
  })}><h2>{workflow ? '编辑工作流' : '添加工作流'}</h2><fieldset disabled={form.formState.isSubmitting}>
    <label className="field-label" htmlFor="workflow-account">所属账号</label>{accountId ? <><Input type="hidden" {...form.register('accountId')} /><Input id="workflow-account" readOnly value={accounts.find((account) => account.id === accountId)?.name ?? ''} /></>
      : <SelectField id="workflow-account" value={form.watch('accountId')} onChange={(event) => form.setValue('accountId', event.target.value, { shouldDirty: true, shouldValidate: true })}><SelectOption value="">选择账号</SelectOption>{accounts.map((account) => <SelectOption key={account.id} value={account.id}>{account.name}</SelectOption>)}</SelectField>}
    <label className="field-label" htmlFor="workflow-kind">工作流类型</label><SelectField id="workflow-kind" value={form.watch('kind') ?? 'video'} onChange={(event) => form.setValue('kind', saveWorkflowSchema.shape.kind.parse(event.target.value), { shouldDirty: true, shouldValidate: true })}>
      <SelectOption value="video">视频生成</SelectOption><SelectOption value="audio">声音生成 / 克隆</SelectOption></SelectField>
    <label className="field-label" htmlFor="workflow-name">名称</label><Input id="workflow-name" autoFocus {...form.register('name')} />
    <label className="field-label" htmlFor="workflow-id">RunningHub 工作流 ID</label><Input id="workflow-id" inputMode="numeric" {...form.register('workflowId')} />
    <label className="check-field"><CheckboxField  checked={form.watch('enabled')} onChange={(event) => form.setValue('enabled', event.target.checked, { shouldDirty: true })} />启用</label>
    <label className="check-field"><CheckboxField  checked={form.watch('isDefault')} onChange={(event) => form.setValue('isDefault', event.target.checked, { shouldDirty: true })} />设为该账号同类型默认工作流</label>
    {Object.values(form.formState.errors).map((issue, index) => <p className="field-error" key={index}>{issue.message ?? '请检查输入'}</p>)}
    {error && <p className="field-error">{error}</p>}
    <div className="dialog-actions"><Button variant="outline" onClick={async () => {
      if (form.formState.isDirty && !(await confirmAction('放弃工作流的未保存修改？'))) return
      onDirty(false); onClose()
    }}>取消</Button><Button type="submit"><FontAwesomeIcon icon={faCheck} />保存</Button></div>
  </fieldset></form>
}

export function WorkflowsPanel({ accountId, onDirty, onNotice }: {
  accountId?: string; onDirty: (value: boolean) => void; onNotice: (message: string) => void
}) {
  const workflows = useWorkflows()
  const accounts = useAccounts()
  const [formPreview, setFormPreview] = useState<Workflow | null>(null)
  const [editing, setEditing] = useState<Workflow | null | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const owners = accounts.data?.accounts ?? []
  const visible = (workflows.data ?? []).filter((workflow) => !accountId || workflow.accountId === accountId)
  async function perform(id: string, action: () => Promise<unknown>) {
    setBusy(id)
    try { await action() } catch (error) { onNotice(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(null) }
  }
  const activeWorkflow = (workflows.data ?? []).find((item) => item.id === formPreview?.id)
  if (activeWorkflow?.kind === 'audio') return <WorkflowWorkspace workflow={activeWorkflow} onBack={() => setFormPreview(null)} onDirty={onDirty} onNotice={onNotice} />
  return <section className="management-page workflow-management"><div className="management-toolbar"><div><h2>工作流</h2><span className="muted">{visible.length} 个工作流</span></div>
    <div className="button-row">
    <Button variant="outline" disabled={busy !== null} title="SelfLift 原生 H3 加速版，提供采样节点与成片输出，无独立低清预览" onClick={() => void perform('download-accelerated', async () => {
      if (await workflows.downloadTemplate('accelerated')) onNotice('加速版工作流已保存，请导入 RunningHub 后添加所属账号的线上工作流 ID')
    })}><FontAwesomeIcon icon={faDownload} />下载加速版</Button>
    <Button disabled={owners.length === 0 || editing !== undefined || busy !== null} onClick={() => setEditing(null)}><FontAwesomeIcon icon={faPlus} />添加工作流</Button></div></div>
    <div className="workflow-template-note"><p><strong>加速版</strong><span>原生 H3 + SelfLift，含采样节点与成片输出，无独立低清预览。</span></p><p>下载后导入 RunningHub，再添加所属账号的线上工作流 ID。</p><div className="workflow-sound-downloads"><span>声音工作流</span><Button variant="outline" size="small" disabled={busy !== null} onClick={() => void perform('download-qwen3', async () => { if (await workflows.downloadTemplate('qwen3-voice-design')) onNotice('音色设计工作流已保存，请导入 RunningHub 后添加线上工作流 ID') })}><FontAwesomeIcon icon={faDownload} />Qwen3 音色设计</Button><Button variant="outline" size="small" disabled={busy !== null} onClick={() => void perform('download-voxcpm2', async () => { if (await workflows.downloadTemplate('voxcpm2-voice-clone')) onNotice('声音克隆工作流已保存，请导入 RunningHub 后添加线上工作流 ID') })}><FontAwesomeIcon icon={faDownload} />VoxCPM2 声音克隆</Button></div></div>
    {(workflows.error || accounts.error) && <p className="field-error">{workflows.error?.message || accounts.error?.message}</p>}
    <div className={`management-layout ${editing !== undefined ? 'editing' : ''}`}><div className="management-table-scroll"><Table className="management-table"><TableHeader><TableRow>
      <TableHead>名称 / 所属账号</TableHead><TableHead>工作流 ID</TableHead><TableHead>类型 / 识别结果</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{visible.map((workflow) => <TableRow key={workflow.id}>
      <TableCell><strong>{workflow.name}{workflow.isDefault && <FontAwesomeIcon className="default-star" icon={faStar} title="账号默认工作流" />}</strong><small>{owners.find((owner) => owner.id === workflow.accountId)?.name ?? '未分配账号'}</small></TableCell><TableCell className="task-id">{workflow.workflowId}</TableCell><TableCell><div>{{ video: '视频生成', audio: '声音生成', image: '图片生成' }[workflow.kind ?? 'video']}</div>{workflow.form ? `${workflow.form.fields.length} 个输入字段` : workflow.capabilities
        ? [workflow.capabilities.sampling ? '采样' : null, workflow.capabilities.draft ? '低清' : null, workflow.capabilities.final ? '成片' : null].filter(Boolean).join(' / ') || '未识别预览节点' : workflow.error || '未检测'}
        {workflow.capabilities && workflow.capabilities.unclassifiedOutputs > 0 && <small>有未分类输出</small>}</TableCell>
      <TableCell>{workflow.kind === 'image' ? '已停用' : workflow.enabled ? '已启用' : '已停用'}<small>{workflow.checkedAt ? new Date(workflow.checkedAt).toLocaleString('zh-CN') : ''}</small></TableCell>
      <TableCell><div className="button-row">{workflow.kind === 'audio' && <Button variant="ghost" size="small" disabled={editing !== undefined} onClick={() => setFormPreview(workflow)}>打开</Button>}<Button variant="ghost" size="icon" title="用所属账号检测线上节点" aria-label="用所属账号检测线上节点" disabled={workflow.kind === 'image' || !owners.some((owner) => owner.id === workflow.accountId && owner.enabled) || busy !== null || editing !== undefined} onClick={() => void perform(workflow.id, () => workflows.inspect(workflow.id))}><FontAwesomeIcon icon={faMagnifyingGlass} /></Button>
        <Button variant="ghost" size="icon" title="设为账号默认" aria-label="设为账号默认" disabled={workflow.kind === 'image' || !workflow.accountId || !workflow.enabled || workflow.isDefault || busy !== null || editing !== undefined} onClick={() => {
          const ownerId = workflow.accountId
          if (!ownerId) return
          void perform(workflow.id, () => workflows.save({ id: workflow.id, accountId: ownerId, name: workflow.name, workflowId: workflow.workflowId, enabled: true, isDefault: true, kind: workflow.kind ?? 'video' }))
        }}><FontAwesomeIcon icon={faStar} /></Button>
        <Button variant="ghost" size="icon" title="编辑工作流" aria-label="编辑工作流" disabled={workflow.kind === 'image' || editing !== undefined || busy !== null} onClick={() => setEditing(workflow)}><FontAwesomeIcon icon={faPen} /></Button>
        <Button variant="ghost" size="icon" title="删除工作流" aria-label="删除工作流" disabled={busy !== null || editing !== undefined} onClick={async () => { if ((await confirmAction(`删除工作流配置「${workflow.name}」？不会删除线上工作流。`))) void perform(workflow.id, () => workflows.remove(workflow.id)) }}><FontAwesomeIcon icon={faTrash} /></Button></div></TableCell>
    </TableRow>)}</TableBody></Table>{!workflows.isPending && visible.length === 0 && <div className="management-empty">暂无工作流</div>}</div>
    {editing !== undefined && <WorkflowForm key={editing?.id ?? 'new'} workflow={editing} accountId={accountId} accounts={owners} onDirty={onDirty} onClose={() => setEditing(undefined)} onSave={workflows.save} />}</div><WorkflowHistory compact accountId={accountId} onNotice={onNotice} />
  </section>
}
