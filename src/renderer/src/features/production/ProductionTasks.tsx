import { SelectOption } from '@/components/ui/select-field'
import { SelectField } from '@/components/ui/select-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faStop, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import type { DialogueTake } from '@contracts/production'
import type { Project } from '@contracts/workspace'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { Button } from '@/components/ui/button'

export function useProductionTasks() {
  return useQuery({ queryKey: ['production-tasks'], queryFn: async () => unwrap(await desktop().listDialogueTasks()), retry: false, refetchInterval: 1500 })
}

const statuses: Record<DialogueTake['status'], string> = { queued: '排队中', running: '生成中', cancelling: '取消中',
  succeeded: '已生成', failed: '失败', cancelled: '已取消', interrupted: '已中断，需核对' }

export function ProductionTasks({ projects, onSelect, onNotice }: {
  projects: Project[]; onSelect: (take: DialogueTake) => void; onNotice: (message: string) => void
}) {
  const tasks = useProductionTasks()
  const [projectId, setProjectId] = useState('all')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const visible = (tasks.data ?? []).filter((take) => (projectId === 'all' || take.projectId === projectId) && (filter === 'all' || take.status === filter))
  return <section className="task-queue-panel" aria-label="台词任务">
    <div className="queue-heading"><h2>台词任务 · {tasks.data?.length ?? 0}</h2><div className="queue-heading-actions"><Button variant="ghost" size="icon" title="刷新台词任务" aria-label="刷新台词任务" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}><FontAwesomeIcon icon={faRotateRight} spin={tasks.isFetching} /></Button></div></div>
    <div className="queue-toolbar"><SelectField aria-label="台词任务项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}><SelectOption value="all">全部项目</SelectOption>{projects.map((project) => <SelectOption value={project.id} key={project.id}>{project.name}</SelectOption>)}</SelectField>
      <SelectField aria-label="台词任务状态" value={filter} onChange={(event) => setFilter(event.target.value)}><SelectOption value="all">全部状态</SelectOption>{Object.entries(statuses).map(([value, label]) => <SelectOption value={value} key={value}>{label}</SelectOption>)}</SelectField></div>
    {tasks.error && <p role="alert" className="field-error">{tasks.error.message}</p>}
    <div className="queue-scroll"><Table className="task-table"><TableHeader><TableRow><TableHead>台词</TableHead><TableHead>项目 / 草稿</TableHead><TableHead>状态</TableHead><TableHead>引擎</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
      {visible.map((take) => {
        const project = projects.find((item) => item.id === take.projectId)
        return <TableRow key={take.id}><TableCell title={take.line.text}>{take.line.character || '台词'}<small className="queue-project-name">{take.id.slice(0, 8)}</small></TableCell>
          <TableCell>{project?.videoDrafts.find((draft) => draft.id === take.draftId)?.title ?? '草稿不可用'}<small className="queue-project-name">{project?.name}</small></TableCell>
          <TableCell title={take.error ?? undefined}>{statuses[take.status]}{take.adopted ? ' · 已采用' : ''}</TableCell><TableCell title={take.line.providerId}>{take.runtime === 'local' ? '本地' : '云端'} · {take.line.voiceId}</TableCell>
          <TableCell><div className="button-row"><Button variant="ghost" size="icon" title="查看台词候选" aria-label="查看台词候选" onClick={() => onSelect(take)}><FontAwesomeIcon icon={faEye} /></Button>
            <Button variant="ghost" size="icon" title="取消台词任务" aria-label="取消台词任务" disabled={busy || !['queued', 'running'].includes(take.status)} onClick={() => {
              setBusy(true)
              void desktop().cancelDialogue({ projectId: take.projectId, draftId: take.draftId, takeId: take.id })
                .then(unwrap).then(() => tasks.refetch()).catch((failure: unknown) => onNotice(failure instanceof Error ? failure.message : '取消失败')).finally(() => setBusy(false))
            }}><FontAwesomeIcon icon={faStop} /></Button></div></TableCell></TableRow>
      })}
    </TableBody></Table>{!visible.length && <div className="queue-empty">{tasks.isFetching ? '读取中' : tasks.error ? '台词任务不可用' : '暂无符合条件的台词任务'}</div>}</div>
  </section>
}
