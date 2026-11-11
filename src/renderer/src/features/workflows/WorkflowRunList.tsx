import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMusic, faImage, faMagnifyingGlass, faCheck, faTrash } from '@fortawesome/free-solid-svg-icons'
import type { WorkflowRun } from '@contracts/workflow-runs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'

export const workflowRunLabels = { preparing: '准备中', submitting: '提交中', unknown: '待核对', running: '生成中', downloading: '保存中', success: '已完成', failed: '生成失败', 'download-error': '保存失败' }

export function WorkflowRunList({ items, selectedId, onPick, onRemove, busy }: { items: WorkflowRun[]; selectedId?: string; onPick: (id: string) => void; onRemove: (run: WorkflowRun) => void; busy: boolean }) {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('all')
  const [limit, setLimit] = useState(40)
  const filtered = items.filter((run) => {
    if (kind !== 'all' && run.kind !== kind) return false
    if (status === 'success' && run.status !== 'success') return false
    if (status === 'active' && !['preparing', 'submitting', 'running', 'downloading'].includes(run.status)) return false
    if (status === 'error' && !['failed', 'unknown', 'download-error'].includes(run.status)) return false
    return `${run.workflowName} ${run.taskId} ${new Date(run.createdAt).toLocaleString('zh-CN')} ${run.assets.map((asset) => asset.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
  })
  return <div className="workflow-history-browser"><div className="workflow-history-filters"><div className="workflow-history-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><Input autoFocus aria-label="搜索运行记录" placeholder="搜索工作流、文件名或任务编号" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(40) }} /></div>
    <div className="workflow-history-filter-row"><SelectField aria-label="筛选结果类型" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(40) }}><SelectOption value="all">全部类型</SelectOption><SelectOption value="audio">音频</SelectOption><SelectOption value="image">图片</SelectOption></SelectField><SelectField aria-label="筛选运行状态" value={status} onChange={(event) => { setStatus(event.target.value); setLimit(40) }}><SelectOption value="all">全部状态</SelectOption><SelectOption value="success">已完成</SelectOption><SelectOption value="active">进行中</SelectOption><SelectOption value="error">异常 / 待核对</SelectOption></SelectField><span>{filtered.length} 条</span></div>
  </div><div className="workflow-history-results">{filtered.slice(0, limit).map((run) => {
    const picture = run.assets.find((asset) => asset.kind === 'image')
    return <div className="workflow-history-choice-row" key={run.id}><Button variant="unstyled" className={`workflow-history-choice ${run.id === selectedId ? 'selected' : ''}`} aria-pressed={run.id === selectedId} onClick={() => onPick(run.id)}>
      <span className="workflow-history-thumbnail">{picture ? <img loading="lazy" src={`workbench-asset://library/${picture.id}`} alt={picture.name} /> : <FontAwesomeIcon icon={run.kind === 'audio' ? faMusic : faImage} />}</span>
      <span className="workflow-history-choice-info"><strong>{run.workflowName}</strong><span>{new Date(run.createdAt).toLocaleString('zh-CN')}</span><span className={`workflow-result-status ${run.status}`}>{workflowRunLabels[run.status]}{run.assets.length > 0 ? ` · ${run.assets.length} 个结果` : ''}</span><span>{run.points != null ? `${run.points} 积分` : '积分未返回'} · {run.executionSeconds != null ? `${run.executionSeconds} 秒` : '时长未返回'}</span></span>{run.id === selectedId && <FontAwesomeIcon className="workflow-history-selected-mark" icon={faCheck} />}
    </Button>{run.status === 'failed' && <Button className="workflow-history-remove" variant="ghost" size="icon" title="移除失败记录" aria-label={`移除失败记录 ${run.workflowName}`} disabled={busy} onClick={() => onRemove(run)}><FontAwesomeIcon icon={faTrash} /></Button>}</div>
  })}{!filtered.length && <p className="workflow-history-no-match">{items.length ? '没有匹配的记录，试试其他关键词或筛选条件' : '暂无运行记录'}</p>}{filtered.length > limit && <Button variant="outline" className="workflow-history-more" onClick={() => setLimit((value) => value + 40)}>加载更多（剩余 {filtered.length - limit} 条）</Button>}</div></div>
}
