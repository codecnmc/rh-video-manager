import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { SelectField } from '@/components/ui/select-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useState, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStop, faPlugCircleXmark, faEye, faRotateRight, faFileLines, faUnlock, faCheck } from '@fortawesome/free-solid-svg-icons'
import type { PreviewSnapshot, RemoteStatus } from '@contracts/preview'
import type { Project } from '@contracts/workspace'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { summarizeQueue, queueStatus, canResolveTask } from '../queue-state'
import { useTaskBatch } from '../use-task-batch'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { TaskTiming } from './TaskTiming'
import { TaskDuration } from './TaskDuration'

const statusLabels = { unknown: '状态待确认', queued: '远端排队中', running: '生成中', success: '远端已完成', failed: '失败', cancelled: '已取消' }

export function TaskQueue({ tasks, projects, actions, loading, error, onReload, onSelect, onDisconnect, onNotice }: {
  tasks: PreviewSnapshot[]; projects: Project[]; actions?: ReactNode; loading: boolean; error: string | undefined; onReload: () => void
  onSelect: (task: PreviewSnapshot) => void; onDisconnect: (id: string) => Promise<void>; onNotice: (message: string) => void
}) {
  const [filter, setFilter] = useState<RemoteStatus | 'all'>('all')
  const [selectedProject, setSelectedProject] = useState('all')
  const [pending, setPending] = useState<string | null>(null)
  const batch = useTaskBatch(onReload, onNotice)
  const actionBusy = pending !== null || batch.busy
  const projectId = projects.some((project) => project.id === selectedProject) ? selectedProject : 'all'
  const scoped = tasks.filter((task) => projectId === 'all' || task.projectId === projectId)
  const counts = summarizeQueue(scoped)
  const visible = scoped.filter((task) => filter === 'all' || queueStatus(task) === filter)
  const selectable = visible.filter((task) => task.taskId && !['success', 'failed', 'cancelled'].includes(queueStatus(task)))
  const chosen = selectable.filter((task) => batch.selected.includes(task.id))
  async function cancel(task: PreviewSnapshot) {
    if (!(await confirmAction('向原账户请求取消此远端任务？取消不保证退款，也不会立即确认终止。'))) return
    setPending(task.id)
    try { unwrap(await desktop().cancelTask(task.id)); onNotice('取消请求已发送，继续核对远端状态') }
    catch (error) { onNotice(error instanceof Error ? error.message : '取消失败') }
    finally { setPending(null) }
  }
  async function refreshResults(task: PreviewSnapshot) {
    if (!(await confirmAction('仅重新获取已有任务结果，不重新生成、不新增生成费用。将按当前线上工作流补回输出角色，请确认该工作流从提交以来未被修改。'))) return
    setPending(task.id)
    try {
      unwrap(await desktop().refreshGenerationResults(task.id, true))
      onReload()
      onNotice('正在重新获取已有结果，不会重新生成')
    } catch (error) { onNotice(error instanceof Error ? error.message : '结果获取失败') }
    finally { setPending(null) }
  }
  async function exportDiagnostics(id: string) {
    setPending(id)
    try { if (unwrap(await desktop().exportTaskDiagnostics(id))) onNotice('任务诊断日志已导出') }
    catch (error) { onNotice(error instanceof Error ? error.message : '日志导出失败') }
    finally { setPending(null) }
  }
  async function releaseReservation(task: PreviewSnapshot) {
    if (!await confirmAction(`手动解除任务 ${task.taskId} 的本地占位？\n请先在 RunningHub 核对原任务。此操作不取消远端任务，不代表已终止或退款；若原任务仍在运行，再次提交可能重复计费。\n原任务与监听会保留，平台实际容量仍会检查。`)) return
    setPending(task.id)
    try {
      unwrap(await desktop().releaseGenerationReservation(task.id, task.taskId, true))
      onReload(); onNotice('已解除本地占位，原任务远端状态与监听保留')
    } catch (error) { onNotice(error instanceof Error ? error.message : '解除占位失败') }
    finally { setPending(null) }
  }
  return <section className="task-queue-panel" aria-label="任务队列" aria-busy={loading}>
    <div className="queue-heading"><h2>任务队列</h2><div className="queue-heading-actions">
      <Button variant="ghost" size="icon" title="刷新本地任务列表" aria-label="刷新本地任务列表" disabled={loading} onClick={onReload}><FontAwesomeIcon icon={faRotateRight} spin={loading} /></Button>{actions}</div>
    </div>
    <div className="queue-toolbar"><SelectField disabled={actionBusy} aria-label="筛选任务所属项目" value={projectId} onChange={(event) => { setSelectedProject(event.target.value); batch.setSelected([]) }}><SelectOption value="all">全部项目</SelectOption>{projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}</SelectField>
      <ToggleGroup type="single" value={filter} className="queue-filters" aria-label="任务状态筛选">{([{ id: 'all', label: '全部' }, { id: 'running', label: '运行中' }, { id: 'queued', label: '排队中' }, { id: 'success', label: '已完成' }, { id: 'failed', label: '失败' }, { id: 'cancelled', label: '已取消' }, { id: 'unknown', label: '待确认' }] as const).map((item) =>
        <ToggleGroupItem disabled={actionBusy} value={item.id} className={filter === item.id ? 'active' : ''} key={item.id} onClick={() => { setFilter(item.id); batch.setSelected([]) }}>{item.label}<span>{item.id === 'all' ? counts.total : counts[item.id]}</span></ToggleGroupItem>)}</ToggleGroup></div>
    {chosen.length > 0 && <div className="button-row queue-batch-actions"><span>已选 {chosen.length} 项</span>
      <Button variant="outline" disabled={actionBusy || chosen.some((task) => ['requested', 'requesting'].includes(task.cancelState))} onClick={() => void batch.run(chosen, 'cancel')}><FontAwesomeIcon icon={faStop} />请求取消</Button>
      <Button variant="outline" disabled={actionBusy || !chosen.every(canResolveTask)} onClick={() => void batch.run(chosen, 'confirm')}><FontAwesomeIcon icon={faCheck} />确认已取消</Button>
      <Button variant="outline" disabled={actionBusy || !chosen.every((task) => canResolveTask(task) && !task.localReservationReleasedAt)} onClick={() => void batch.run(chosen, 'release')}><FontAwesomeIcon icon={faUnlock} />仅解除占位</Button>
      <Button variant="ghost" disabled={actionBusy} onClick={() => batch.setSelected([])}>取消选择</Button></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="queue-scroll"><Table className="task-table video-task-table"><TableHeader><TableRow><TableHead scope="col" className="queue-selection"><CheckboxField aria-label="选择当前筛选下全部未结束任务" disabled={actionBusy || !selectable.length} checked={selectable.length > 0 && chosen.length === selectable.length} onChange={(event) => batch.setSelected(event.target.checked ? selectable.map((task) => task.id) : [])} /></TableHead><TableHead scope="col">任务 ID</TableHead><TableHead scope="col">项目 / 视频草稿</TableHead><TableHead scope="col">成片时长</TableHead><TableHead scope="col">状态</TableHead><TableHead scope="col">预览</TableHead><TableHead scope="col">操作</TableHead></TableRow></TableHeader>
      <TableBody>{visible.map((task) => {
        const project = projects.find((item) => item.id === task.projectId)
        const draft = project?.videoDrafts.find((item) => item.id === task.draftId)
        const terminal = ['success', 'failed', 'cancelled'].includes(queueStatus(task))
        return <TableRow key={task.id}><TableCell className="queue-selection"><CheckboxField aria-label={`选择任务 ${task.taskId || task.id}`} disabled={actionBusy || terminal || !task.taskId} checked={chosen.some((item) => item.id === task.id)} onChange={(event) => batch.setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /></TableCell><TableCell className="task-id" title={task.taskId || task.id}>{task.taskId || '尚未取得远端 ID'}</TableCell><TableCell title={`${project?.name ?? '项目不可用'} / ${draft?.title ?? '草稿不可用'}`}>{draft?.title ?? '草稿不可用'}<small className="queue-project-name">{project?.name ?? '项目不可用'}</small></TableCell>
          <TableCell className="queue-duration-cell"><TaskDuration task={task} /></TableCell>
          <TableCell className="queue-status-cell"><div className="queue-status-heading"><span className={`task-status queue-status-badge status-${queueStatus(task)}`}>{task.manualCancellationConfirmedAt && task.remoteStatus !== 'success' && task.remoteStatus !== 'failed' ? '已取消·人工确认' : !terminal && task.cancelState === 'requested' ? '取消已受理·待确认' : statusLabels[task.remoteStatus]}</span>
            {(task.notice || task.stage || task.manualCancellationConfirmedAt || task.localReservationReleasedAt || task.cancelState !== 'none') && <details className="queue-status-details"><summary>详情</summary>
              {task.manualCancellationConfirmedAt && <p>最后远端状态：{statusLabels[task.remoteStatus]} · 人工确认非平台回执，不代表退款</p>}
              {(task.notice || task.stage) && <p>{task.notice || task.stage}</p>}
              {task.localReservationReleasedAt && <p>已解除本地占位 · 远端状态独立核对</p>}
              {!terminal && task.cancelState !== 'none' && <p>{task.cancelState === 'requested' ? '取消已受理，正在核对远端终态；不保证退款' : task.cancelState === 'requesting' ? '正在请求取消' : '取消异常待核对'}</p>}
            </details>}</div>
            <small className="queue-status-timing"><TaskTiming task={task} /></small></TableCell>
          <TableCell className="muted">{task.draft ? '低清已就绪' : task.sampling ? terminal || task.cancelState === 'requested' ? '采样已保存' : '采样中' : terminal ? '无采样' : '等待预览'}{task.final ? ' · 成片已就绪' : task.resultVideos?.length ? ' · 有未分类输出' : ''}</TableCell>
          <TableCell><fieldset className="queue-action-fieldset" disabled={batch.busy}><div className="button-row"><Button variant="ghost" size="icon" title="查看预览" aria-label="查看预览" disabled={!draft} onClick={() => onSelect(task)}><FontAwesomeIcon icon={faEye} /></Button>
            {canResolveTask(task) && <Button variant="ghost" size="icon" title="人工确认远端已取消" aria-label="人工确认远端已取消" disabled={actionBusy} onClick={() => void batch.run([task], 'confirm')}><FontAwesomeIcon icon={faCheck} /></Button>}
            {terminal && task.remoteStatus !== 'cancelled' && task.taskId && <Button variant="ghost" size="icon" title="重新获取平台结果，不重新生成" aria-label="重新获取平台结果，不重新生成" disabled={pending !== null || task.connection === 'connecting'} onClick={() => void refreshResults(task)}><FontAwesomeIcon icon={faRotateRight} spin={pending === task.id} /></Button>}
            <Button variant="ghost" size="icon" title="导出任务诊断日志" aria-label="导出任务诊断日志" disabled={pending !== null} onClick={() => void exportDiagnostics(task.id)}><FontAwesomeIcon icon={faFileLines} /></Button>
            {canResolveTask(task) && !task.localReservationReleasedAt &&
              <Button variant="ghost" size="icon" title="手动解除本地占位" aria-label="手动解除本地占位" disabled={pending !== null} onClick={() => void releaseReservation(task)}><FontAwesomeIcon icon={faUnlock} /></Button>}
            <Button variant="ghost" size="icon" title="取消远端任务" aria-label="取消远端任务" disabled={!task.taskId || terminal || pending !== null || task.cancelState === 'requested' || task.cancelState === 'requesting'} onClick={() => void cancel(task)}><FontAwesomeIcon icon={faStop} /></Button>
            <Button variant="ghost" size="icon" title="移除本地监听，不取消远端任务" aria-label="移除本地监听" disabled={pending !== null} onClick={async () => {
              if ((await confirmAction('仅移除本地监听，远端任务将继续运行。确定移除？'))) void onDisconnect(task.id).catch(() => onNotice('移除监听失败'))
            }}><FontAwesomeIcon icon={faPlugCircleXmark} /></Button></div></fieldset></TableCell>
        </TableRow>
      })}</TableBody></Table>{visible.length === 0 && <div className="queue-empty">{loading ? '正在读取任务' : error ? '任务列表暂不可用' : tasks.length ? '没有符合条件的任务' : '暂无生成任务'}</div>}</div>
  </section>
}
