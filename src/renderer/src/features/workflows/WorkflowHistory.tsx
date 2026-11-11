import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faSpinner, faFolderOpen, faMicrophone, faMusic, faImage, faClockRotateLeft, faArrowLeft, faExpand, faTrash } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Dialog } from '@/components/ui/dialog'
import { WorkflowRunList, workflowRunLabels } from './WorkflowRunList'
import { useWorkflowRuns } from './use-workflow-runs'
import type { WorkflowRun } from '@contracts/workflow-runs'

export function WorkflowHistory({ workflowId, accountId, compact = false, disabled = false, latestRunToken = 0, onSelectRun, onNotice }: { latestRunToken?: number; disabled?: boolean; onSelectRun?: (run: WorkflowRun) => Promise<boolean>; compact?: boolean; workflowId?: string; accountId?: string; onNotice: (message: string) => void }) {
  const history = useWorkflowRuns(workflowId)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [kind, setKind] = useState('all')
  const [drawer, setDrawer] = useState<'list' | 'preview' | null>(null)
  useEffect(() => { setSelectedId(''); setDrawer(null) }, [latestRunToken])
  const [image, setImage] = useState<{ id: string; name: string } | null>(null)
  const items = (history.data ?? []).filter((run) => (!accountId || run.accountId === accountId) && (kind === 'all' || run.kind === kind))
  const latest = items[0]
  const latestPicture = latest?.assets.find((asset) => asset.kind === 'image')
  const run = items.find((item) => item.id === selectedId) ?? items[0]
  const labels = workflowRunLabels
  const processing = run && ['preparing', 'submitting', 'running', 'downloading'].includes(run.status)
  async function act(id: string, action: () => Promise<unknown>) {
    if (busy) return
    setBusy(id)
    try { await action() } catch (error) { onNotice(error instanceof Error ? error.message : '操作失败') } finally { setBusy(null) }
  }
  async function pickRun(id: string, latest = false) {
    const selected = items.find((item) => item.id === id)
    if (!selected || disabled || busy) return
    setBusy(id)
    try {
      if (onSelectRun && !await onSelectRun(selected)) return
      setSelectedId(latest ? '' : id); setDrawer(compact ? 'preview' : null)
    } catch (error) { onNotice(error instanceof Error ? error.message : '选择记录失败') } finally { setBusy(null) }
  }
  const result = run ? <>
      <div className="workflow-result-content">
        {processing && <div className="workflow-result-progress"><FontAwesomeIcon icon={faSpinner} spin /><strong>{run.status === 'downloading' ? '正在保存生成结果' : run.status === 'running' ? '正在生成，请稍候' : '正在准备任务'}</strong><span className="muted">完成后会自动显示在这里</span></div>}
        {['failed', 'unknown', 'download-error'].includes(run.status) && <div className="workflow-result-error"><strong>{labels[run.status]}</strong><p>{run.message}</p>{run.status === 'download-error' && <Button variant="outline" size="small" disabled={busy !== null} onClick={() => void act(run.id, () => history.refresh(run.id))}>重试保存</Button>}</div>}
        {run.assets.map((asset, index) => <article className="workflow-result-asset" key={asset.id}><header><strong><FontAwesomeIcon icon={asset.kind === 'audio' ? faMusic : faImage} />{asset.kind === 'audio' ? '音频结果' : '图片结果'}{run.assets.length > 1 ? ` ${index + 1}` : ''}</strong>{run.status === 'success' && <span className="muted">已存入公共素材库</span>}</header>
          {asset.kind === 'image' ? <img src={`workbench-asset://library/${asset.id}`} alt={asset.name} /> : <audio controls preload="metadata" src={`workbench-asset://library/${asset.id}`} aria-label={`试听 ${asset.name}`} />}
          <div className="workflow-result-asset-actions">{asset.kind === 'image' && <Button variant="outline" size="small" onClick={() => setImage(asset)}><FontAwesomeIcon icon={faExpand} />查看大图</Button>}<Button variant="outline" size="small" disabled={busy !== null} onClick={() => void act(asset.id, () => history.reveal(asset.id))}><FontAwesomeIcon icon={faFolderOpen} />打开位置</Button>
            {asset.kind === 'audio' && <Button variant="outline" size="small" disabled={busy !== null} onClick={() => void act(asset.id, async () => { await history.makeVoice(asset.id); onNotice('已创建公共参考音色副本') })}><FontAwesomeIcon icon={faMicrophone} />加入音色库</Button>}</div>
        </article>)}
      </div><div className="workflow-run-metrics"><span>积分消耗 <strong>{run.points ?? '未返回'}</strong></span><span>运行时长 <strong>{run.executionSeconds != null ? `${run.executionSeconds} 秒` : '未返回'}</strong></span>{run.status === 'failed' && <Button variant="ghost" size="small" disabled={busy !== null} onClick={() => void act(run.id, () => history.removeFailed(run.id, run.updatedAt))}><FontAwesomeIcon icon={faTrash} />移除失败记录</Button>}</div><details className="workflow-result-details"><summary>任务详情</summary><p>{run.workflowName} · {new Date(run.createdAt).toLocaleString('zh-CN')}</p>{run.taskId && <p>任务编号：{run.taskId}</p>}<p>{run.message}</p>{run.assets.map((asset) => <p key={asset.id}>{asset.name}</p>)}</details>
    </> : <div className="workflow-result-empty"><FontAwesomeIcon icon={faMusic} /><strong>{history.isPending ? '正在加载结果' : '等待生成结果'}</strong><span>运行后自动获取，可在这里试听或预览</span></div>
  return <section className={`workflow-history workflow-result-panel ${compact ? 'workflow-results-compact' : ''}`}><header className="workflow-result-heading"><div><h3>{compact ? '历史结果' : '生成结果'}</h3>{compact && <span className="muted">音频与图片产物，所有项目可用</span>}</div><div className="button-row">{!compact && run && <span className={`workflow-result-status ${run.status}`}>{processing ? <FontAwesomeIcon icon={faSpinner} spin /> : run.status === 'success' ? <FontAwesomeIcon icon={faCheck} /> : null}{labels[run.status]}</span>}<Button variant="outline" size="small" disabled={disabled || busy !== null} onClick={() => setDrawer('list')}><FontAwesomeIcon icon={faClockRotateLeft} />历史记录{items.length > 0 ? `（${items.length}）` : ''}</Button></div></header>
    {history.error && <p role="alert" className="field-error">{history.error.message}</p>}
    {compact && <div className="workflow-result-type-filter"><SelectField aria-label="筛选历史结果类型" value={kind} onChange={(event) => { setKind(event.target.value); setSelectedId('') }}><SelectOption value="all">全部结果类型</SelectOption><SelectOption value="audio">声音生成 / 克隆</SelectOption><SelectOption value="image">图片生成</SelectOption></SelectField><span className="muted">{items.length} 条记录</span></div>}
    {!compact && <><div className="workflow-current-result"><span>{selectedId ? '历史结果' : '最新结果'}{run ? ` · ${new Date(run.createdAt).toLocaleString('zh-CN')}` : ''}</span>{selectedId && <Button variant="ghost" size="small" disabled={disabled || busy !== null} onClick={() => { if (items[0]) void pickRun(items[0].id, true) }}>回到最新</Button>}</div>{result}</>}
    {compact && latest && <Button variant="unstyled" className="workflow-latest-result" onClick={() => { setSelectedId(''); setDrawer('preview') }}><span className="workflow-latest-result-icon">{latestPicture ? <img src={`workbench-asset://library/${latestPicture.id}`} alt="最新图片结果" /> : <FontAwesomeIcon icon={latest.kind === 'audio' ? faMusic : faImage} />}</span><span><strong>{latest.workflowName}</strong><small>{new Date(latest.createdAt).toLocaleString('zh-CN')} · {labels[latest.status]}</small></span><span className="workflow-latest-result-open">查看最新结果</span></Button>}
    {drawer && <Dialog className="workflow-history-drawer" title={drawer === 'list' ? '历史记录' : '生成结果'} onClose={() => setDrawer(null)}>{drawer === 'list' ? <WorkflowRunList busy={busy !== null || disabled} onRemove={(item) => void act(item.id, () => history.removeFailed(item.id, item.updatedAt))} items={items} selectedId={run?.id} onPick={(id) => { void pickRun(id) }} /> : <div className="workflow-drawer-preview"><Button variant="ghost" size="small" disabled={disabled || busy !== null} onClick={() => setDrawer('list')}><FontAwesomeIcon icon={faArrowLeft} />返回历史记录</Button><div className="workflow-drawer-preview-heading"><strong>{run?.workflowName}</strong><span className="muted">{run ? new Date(run.createdAt).toLocaleString('zh-CN') : ''}</span></div>{result}</div>}</Dialog>}
    {image && <Dialog className="workflow-image-preview" title="图片预览" onClose={() => setImage(null)}><img src={`workbench-asset://library/${image.id}`} alt={image.name} /></Dialog>}
  </section>
}
