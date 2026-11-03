import { confirmAction } from '@/components/ui/confirmation'
import { Input } from '@/components/ui/input'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash, faRotateRight, faCheck, faDiagramProject, faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { saveAccountSchema, type Account, type AccountPool, type SaveAccount } from '@contracts/accounts'
import { Button } from '@/components/ui/button'
import { useAccounts } from './use-accounts'

const keyTypeLabels = new Map([['EXCLUSIVE', '独占'], ['SHARED', '共享'], ['NORMAL', '消费级']])
const syncTime = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function AccountSummary({ pool }: { pool: AccountPool | undefined }) {
  const metrics: { label: string; value: string | number | null | undefined; unit?: string; title?: string }[] = [
    { label: 'RH 币余额', value: pool?.totalCoins, unit: 'RH' },
    ...(pool?.wallets.map((wallet) => ({ label: '钱包余额', value: wallet.amount, unit: wallet.currency })) ?? []),
    { label: '本地并发上限', value: pool?.concurrency },
    { label: 'Key 远端并发上限', value: pool?.remoteConcurrency },
    { label: '远端运行', value: pool?.runningTasks },
    { label: '远端排队', value: pool?.queuedTasks },
    { label: '当前总任务', value: pool?.totalCurrentTasks },
    { label: '远端空位快照', value: pool?.availableSlots, title: '各 Key 的 max(0, 远端并发上限 − 运行数) 之和；不代表已预留容量' }
  ]
  return <dl className="account-summary">{metrics.map((metric) => <div key={`${metric.label}-${metric.unit ?? ''}`} title={metric.title}>
    <dt>{metric.label}</dt><dd className={metric.value == null ? 'is-unknown' : ''}>{metric.value ?? '未同步'}{metric.unit && metric.value != null && <span>{metric.unit}</span>}</dd>
  </div>)}</dl>
}

function AccountSyncState({ label, status, checkedAt, error }: {
  label: string; status: Account['status']; checkedAt: string | null; error: string
}) {
  const timestamp = checkedAt ? new Date(checkedAt) : null
  const validTime = timestamp !== null && !Number.isNaN(timestamp.getTime())
  return <div className="account-sync-state"><div className="account-sync-line">
    <span>{label}</span><span className={`account-sync-dot sync-${status}`} role="img" aria-label={status === 'ready' ? '已同步' : status === 'error' ? '同步失败' : '未同步'} />
    {validTime ? <time dateTime={timestamp.toISOString()} title={`上次成功同步：${timestamp.toLocaleString('zh-CN')}`}>{syncTime.format(timestamp)}</time> : <span className="muted">{checkedAt ? '时间未知' : '未同步'}</span>}
  </div>{error && <small className="field-error">{error}</small>}</div>
}

function AccountForm({ account, onSave, onClose, onDirty }: {
  account: Account | null; onSave: (input: SaveAccount) => Promise<void>; onClose: () => void; onDirty: (dirty: boolean) => void
}) {
  const form = useForm<SaveAccount>({ resolver: zodResolver(saveAccountSchema), defaultValues: account
    ? { id: account.id, name: account.name, identity: account.identity, apiKey: '', enabled: account.enabled, concurrency: account.concurrency }
    : { id: null, name: '', identity: '', apiKey: '', enabled: true, concurrency: 0 } })
  const [error, setError] = useState('')
  useEffect(() => { onDirty(form.formState.isDirty) }, [form.formState.isDirty, onDirty])
  return <form className="management-form" onSubmit={form.handleSubmit(async (input) => {
    try { await onSave(input); onDirty(false); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') }
    finally { form.setValue('apiKey', '') }
  })}><h2>{account ? '编辑账号' : '添加账号'}</h2><fieldset disabled={form.formState.isSubmitting}>
    <label className="field-label" htmlFor="account-name">账号名称</label><Input id="account-name" autoFocus {...form.register('name')} />
    <label className="field-label" htmlFor="account-identity">RunningHub 账号标识（同账号唯一）</label><Input id="account-identity" {...form.register('identity')} />
    <label className="field-label" htmlFor="account-key">{account ? `替换 API Key · 当前 ${account.keyHint}` : 'API Key'}</label>
    <Input id="account-key" type="password" autoComplete="new-password" spellCheck={false} placeholder={account ? '留空保留现有 Key' : ''} {...form.register('apiKey')} />
    <label className="field-label" htmlFor="account-concurrency">本地并发上限</label><Input id="account-concurrency" readOnly value={account ? account.concurrency : '待同步'} title="由 RunningHub 队列同步更新" />
    <label className="check-field"><CheckboxField  checked={form.watch('enabled')} onChange={(event) => form.setValue('enabled', event.target.checked, { shouldDirty: true, shouldValidate: true })} />启用账号</label>
    {Object.values(form.formState.errors).map((issue, index) => <p key={index} className="field-error">{issue.message ?? '请检查输入'}</p>)}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions"><Button variant="outline" onClick={async () => {
      if (form.formState.isDirty && !(await confirmAction('放弃账号配置的未保存修改？'))) return
      onDirty(false); onClose()
    }}>取消</Button><Button type="submit"><FontAwesomeIcon icon={faCheck} />保存并同步</Button></div>
  </fieldset></form>
}

export function AccountsPanel({ onDirty, onNotice, renderWorkflows }: {
  onDirty: (dirty: boolean) => void; onNotice: (message: string) => void
  renderWorkflows: (account: Account, onWorkflowDirty: (dirty: boolean) => void) => ReactNode
}) {
  const accounts = useAccounts()
  const [editing, setEditing] = useState<Account | null | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [managedAccount, setManagedAccount] = useState<string | null>(null)
  const [workflowDirty, setWorkflowDirty] = useState(false)
  const onWorkflowDirty = useCallback((value: boolean) => { setWorkflowDirty(value); onDirty(value) }, [onDirty])
  async function perform(id: string, action: () => Promise<unknown>) {
    setBusy(id)
    try { await action() } catch (error) { onNotice(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(null) }
  }
  const pool = accounts.data
  const managed = pool?.accounts.find((account) => account.id === managedAccount)
  if (managed) return <div className="account-workflows"><div className="account-workflow-heading"><Button variant="ghost" size="icon" title="返回账号池" aria-label="返回账号池" onClick={async () => {
    if (workflowDirty && !(await confirmAction('放弃工作流的未保存修改？'))) return
    setManagedAccount(null); setWorkflowDirty(false); onDirty(false)
  }}><FontAwesomeIcon icon={faArrowLeft} /></Button><h2>{managed.name}</h2><span className="muted">{managed.keyHint}</span></div>
    {renderWorkflows(managed, onWorkflowDirty)}</div>
  return <section className="management-page accounts-page">
    <div className="management-toolbar"><div><h2>账号概览</h2><span className="muted">{pool ? `${pool.enabledCount} 个启用账号 · 额度已同步 ${pool.syncedCount}/${pool.enabledCount} · 队列已同步 ${pool.queueSyncedCount}/${pool.enabledCount}` : '正在读取账号'}</span></div>
      <div className="button-row"><Button variant="outline" disabled={busy !== null} onClick={() => void perform('refresh', () => accounts.refresh())}><FontAwesomeIcon icon={faRotateRight} spin={busy === 'refresh'} />同步额度与队列</Button>
        <Button disabled={editing !== undefined || busy !== null} onClick={() => setEditing(null)}><FontAwesomeIcon icon={faPlus} />添加账号</Button></div></div>
    {accounts.error && <p className="field-error">{accounts.error.message}</p>}
    <AccountSummary pool={pool} />
    <div className={`management-layout ${editing !== undefined ? 'editing' : ''}`}><div className="management-table-scroll"><Table className="management-table account-table"><TableHeader><TableRow>
      <TableHead scope="col">账号</TableHead><TableHead scope="col">Key / 类型</TableHead><TableHead scope="col">RH 币 / 钱包</TableHead><TableHead scope="col">并发上限</TableHead><TableHead scope="col">远端队列</TableHead><TableHead scope="col">同步状态</TableHead><TableHead scope="col">操作</TableHead></TableRow></TableHeader><TableBody>
      {pool?.accounts.map((account) => <TableRow key={account.id}><TableCell><div className="account-identity"><strong title={account.name}>{account.name}</strong><small title={account.identity}>{account.identity}</small></div>
        <label className="check-field account-enabled"><CheckboxField  checked={account.enabled} aria-label={`${account.enabled ? '停用' : '启用'}账号 ${account.name}`} disabled={busy !== null || editing !== undefined}
          onChange={(event) => void perform(account.id, () => accounts.save({ id: account.id, name: account.name, identity: account.identity, apiKey: '', concurrency: account.concurrency, enabled: event.target.checked }))} />{account.enabled ? '已启用' : '已停用'}</label></TableCell>
        <TableCell><span className="account-key-hint">{account.keyHint}</span><small>{account.queue ? (keyTypeLabels.get(account.queue.apiKeyType) ?? account.queue.apiKeyType) : '类型未同步'}</small></TableCell>
        <TableCell><strong className="account-balance-value">{account.balance?.coins ?? '未同步'}</strong><small>{account.balance?.money !== null && account.balance?.money !== undefined ? `${account.balance.money} ${account.balance.currency ?? ''}` : '钱包未提供'}</small></TableCell>
        <TableCell><div className="account-value-pair"><span>本地</span><strong>{account.concurrency}</strong></div><div className="account-value-pair"><span>远端</span><strong>{account.queue?.concurrentLimit ?? '未同步'}</strong></div></TableCell>
        <TableCell>{account.queue ? <><div className="account-queue-counts"><span>运行 <strong>{account.queue.runningCount}</strong></span><span>排队 <strong>{account.queue.queuedCount}</strong></span></div>
          <small>总数 {account.queue.totalCurrentTasks} · 空位 {Math.max(0, account.queue.concurrentLimit - account.queue.runningCount)}</small>{account.queueStatus === 'error' && <small className="field-error">旧快照</small>}</> : <span className="muted">未同步</span>}</TableCell>
        <TableCell><AccountSyncState label="额度" status={account.status} checkedAt={account.checkedAt} error={account.error} />
          <AccountSyncState label="队列" status={account.queueStatus} checkedAt={account.queueCheckedAt} error={account.queueError} /></TableCell>
        <TableCell><div className="button-row account-row-actions"><Button variant="ghost" size="icon" title="同步账号" aria-label="同步账号" disabled={busy !== null} onClick={() => void perform(account.id, () => accounts.refresh(account.id))}><FontAwesomeIcon icon={faRotateRight} spin={busy === account.id} /></Button>
          <Button variant="ghost" size="icon" title="管理此账号的工作流" aria-label="管理此账号的工作流" disabled={editing !== undefined || busy !== null} onClick={() => setManagedAccount(account.id)}><FontAwesomeIcon icon={faDiagramProject} /></Button>
          <Button variant="ghost" size="icon" title="编辑账号" aria-label="编辑账号" disabled={editing !== undefined || busy !== null} onClick={() => setEditing(account)}><FontAwesomeIcon icon={faPen} /></Button>
          <Button className="account-delete-action" variant="ghost" size="icon" title="删除账号" aria-label="删除账号" disabled={busy !== null || editing !== undefined} onClick={async () => {
            if ((await confirmAction(`删除账号「${account.name}」及本地加密 Key？不会取消远端任务。`))) void perform(account.id, () => accounts.remove(account.id))
          }}><FontAwesomeIcon icon={faTrash} /></Button></div></TableCell></TableRow>)}
    </TableBody></Table>{pool?.accounts.length === 0 && <div className="management-empty">暂无账号</div>}</div>
      {editing !== undefined && <AccountForm key={editing?.id ?? 'new'} account={editing} onDirty={onDirty} onClose={() => setEditing(undefined)} onSave={async (input) => {
        const next = await accounts.save(input)
        const saved = next.accounts.find((entry) => entry.identity === input.identity)
        if (saved) await accounts.refresh(saved.id)
        onNotice('账号配置已保存')
      }} />}</div>
    {pool && (pool.syncedCount !== pool.enabledCount || pool.queueSyncedCount !== pool.enabledCount) && <p className="inline-warning">额度与队列分别汇总，仅含启用且对应查询成功的账号。</p>}
    {editing === undefined && accounts.isPending && <p className="muted"><FontAwesomeIcon icon={faRotateRight} spin />正在读取账号</p>}
  </section>
}
