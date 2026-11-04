import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faChevronLeft, faChevronRight, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import type { Account } from '@contracts/accounts'
import type { TaskConsumption } from '@contracts/consumption'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useConsumption } from './use-consumption'

const pageSize = 50
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function ConsumptionTime({ value }: { value: string }) {
  const date = new Date(value)
  return <time dateTime={value}><span>{dateFormat.format(date)}</span><small>{timeFormat.format(date)}</small></time>
}

function ConsumptionAmount({ consumption, field }: { consumption: TaskConsumption | null; field: 'coins' | 'money' | 'thirdPartyMoney' }) {
  if (consumption?.conflictingFields.includes(field)) return <span className="field-error" title="平台多个输出的费用不一致或格式无效，未纳入合计">数据冲突</span>
  return <span title={consumption?.[field] ?? '未知'}>{consumption?.[field] ?? '未知'}</span>
}

export function ConsumptionDetails({ accounts, onBack }: { accounts: Account[]; onBack: () => void }) {
  const [accountId, setAccountId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState('')
  const invalidRange = Boolean(from && to && from > to)
  const consumption = useConsumption({ ...(accountId ? { accountId } : {}), ...(projectId ? { projectId } : {}),
    ...(from && !invalidRange ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to && !invalidRange ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) })
  const ledger = consumption.data
  const projects = consumption.workspace.data?.projects ?? []
  const projectIds = [...new Set([...(projectId ? [projectId] : []), ...(ledger?.entries.map((entry) => entry.projectId) ?? []), ...projects.map((project) => project.id)])]
  const accountIds = [...new Set([...(accountId ? [accountId] : []), ...(ledger?.entries.map((entry) => entry.accountId) ?? []), ...accounts.map((account) => account.id)])]
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? `历史项目 ${id.slice(0, 8)}`
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? `已移除账号 ${id.slice(0, 8)}`
  const entries = invalidRange ? [] : (ledger?.entries ?? []).filter((entry) => entry.remoteStatus === 'success')
  const lastPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const missing = entries.filter((entry) => entry.consumption?.coins == null).slice(0, 20)
  const busy = consumption.refresh.isPending
  async function refresh(ids: string[]) {
    setNotice('')
    const result = await consumption.refresh.mutateAsync(ids)
    setNotice(result.failed
      ? `已查询 ${result.total} 笔，${result.failed} 笔失败；请检查原账号配置、权限或平台结果有效期，兼容接口可能已停用。`
      : `已查询 ${result.total} 笔；平台未返回的费用仍为未知。`)
  }
  return <section className="management-page accounts-page consumption-page">
    <div className="management-toolbar"><div className="button-row">
      <Button variant="ghost" size="icon" title="返回账号池" aria-label="返回账号池" disabled={busy} onClick={onBack}><FontAwesomeIcon icon={faArrowLeft} /></Button><h2>成功任务消费明细</h2>
    </div><div className="button-row">
      <Button variant="outline" disabled={busy || invalidRange || missing.length === 0} onClick={() => void refresh(missing.map((entry) => entry.id))}><FontAwesomeIcon icon={faRotateRight} spin={busy} />补查未知费用（最多 20 笔）</Button>
      <Button variant="outline" size="icon" title="刷新本地明细" aria-label="刷新本地明细" disabled={busy || consumption.isFetching} onClick={() => void consumption.refetch()}><FontAwesomeIcon icon={faRotateRight} spin={consumption.isFetching} /></Button>
    </div></div>
    <div className="consumption-filters">
      <label>账号<SelectField value={accountId} onChange={(event) => { setAccountId(event.target.value); setPage(0) }} disabled={busy}><SelectOption value="">全部账号</SelectOption>{accountIds.map((id) => <SelectOption key={id} value={id}>{accountName(id)}</SelectOption>)}</SelectField></label>
      <label>项目<SelectField value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(0) }} disabled={busy}><SelectOption value="">全部项目</SelectOption>{projectIds.map((id) => <SelectOption key={id} value={id}>{projectName(id)}</SelectOption>)}</SelectField></label>
      <label>开始日期<Input type="date" value={from} max={to || undefined} disabled={busy} onChange={(event) => { setFrom(event.target.value); setPage(0) }} /></label>
      <label>结束日期<Input type="date" value={to} min={from || undefined} disabled={busy} onChange={(event) => { setTo(event.target.value); setPage(0) }} /></label>
    </div>
    {invalidRange && <p className="field-error" role="alert">结束日期不能早于开始日期</p>}
    {consumption.error && <p className="field-error" role="alert">{consumption.error.message}</p>}
    {consumption.workspace.error && <p className="field-error">项目名称读取失败，暂时显示项目编号</p>}
    <dl className="account-summary"><div><dt>成功任务已知耗币</dt><dd>{invalidRange ? '未知' : ledger?.knownCoins ?? '未知'}<span>RH 币</span></dd></div>
      <div><dt>耗币已知</dt><dd>{invalidRange ? '未知' : ledger?.knownCount ?? '未知'}<span>笔</span></dd></div>
      <div><dt>耗币未知 / 冲突</dt><dd>{invalidRange ? '未知' : ledger?.unknownCount ?? '未知'}<span>笔</span></dd></div>
    </dl>
    {notice && <p className="inline-warning" role="status">{notice}</p>}
    <div className="management-table-scroll consumption-table-scroll" role="region" aria-label="成功任务消费明细" tabIndex={0}><Table className="management-table consumption-table"><colgroup>
      <col className="consumption-col-time" /><col /><col className="consumption-col-account" />
      <col className="consumption-col-amount" /><col className="consumption-col-amount" /><col className="consumption-col-api" /><col className="consumption-col-query" />
    </colgroup><TableHeader><TableRow>
      <TableHead scope="col">提交时间</TableHead><TableHead scope="col">项目 / 任务</TableHead><TableHead scope="col">账号 / 工作流</TableHead>
      <TableHead scope="col" className="consumption-number">RH 币</TableHead><TableHead scope="col" className="consumption-number" title="consumeMoney，平台未声明币种，不与 RH 币相加">运行费用</TableHead>
      <TableHead scope="col" className="consumption-number" title="thirdPartyConsumeMoney，平台未声明币种，不与 RH 币相加">第三方 API 费用</TableHead><TableHead scope="col">费用查询</TableHead>
    </TableRow></TableHeader><TableBody>{visible.map((entry) => <TableRow key={entry.id}>
      <TableCell><ConsumptionTime value={entry.submittedAt} /></TableCell>
      <TableCell><strong className="consumption-task-title" title={entry.title}>{entry.title}</strong><small className="consumption-project-name" title={`${projectName(entry.projectId)} · ${entry.projectId}`}>{projectName(entry.projectId)}</small><small>{entry.taskId}</small></TableCell>
      <TableCell><span className="consumption-account-name" title={`${accountName(entry.accountId)} · ${entry.accountId}`}>{accountName(entry.accountId)}</span><small>{entry.workflowId}</small></TableCell>
      <TableCell className="consumption-number"><ConsumptionAmount consumption={entry.consumption} field="coins" /></TableCell>
      <TableCell className="consumption-number"><ConsumptionAmount consumption={entry.consumption} field="money" /></TableCell>
      <TableCell className="consumption-number"><ConsumptionAmount consumption={entry.consumption} field="thirdPartyMoney" /></TableCell>
      <TableCell><div className="consumption-query"><Button variant="ghost" size="icon" title="查询原任务费用（不会重新生成）" aria-label={`查询 ${entry.title} 费用`} disabled={busy} onClick={() => void refresh([entry.id])}><FontAwesomeIcon icon={faRotateRight} spin={busy && consumption.refresh.variables?.includes(entry.id)} /></Button>
        {entry.consumption ? <ConsumptionTime value={entry.consumption.checkedAt} /> : <span className="muted">未查询</span>}</div></TableCell>
    </TableRow>)}</TableBody></Table>
      {!consumption.isPending && !consumption.error && entries.length === 0 && !invalidRange && <div className="management-empty">暂无成功任务消费记录</div>}
      {consumption.isPending && <div className="management-empty">正在读取消费明细</div>}
    </div>
    <div className="management-toolbar"><span className="muted">{entries.length} 笔 · 第 {currentPage + 1} / {lastPage + 1} 页</span><div className="button-row">
      <Button variant="outline" size="icon" title="上一页" aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>
      <Button variant="outline" size="icon" title="下一页" aria-label="下一页" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}><FontAwesomeIcon icon={faChevronRight} /></Button>
    </div></div>
  </section>
}
