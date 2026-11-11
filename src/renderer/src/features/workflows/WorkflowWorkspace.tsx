import { useCallback, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faPen, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import type { Workflow } from '@contracts/workflows'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/ui/confirmation'
import { WorkflowInputs } from './WorkflowInputs'
import { WorkflowApplicationEditor } from './WorkflowApplicationEditor'
import { WorkflowHistory } from './WorkflowHistory'
import { useWorkflowRuns } from './use-workflow-runs'
import { useWorkflows } from './use-workflows'
import './workflow-inputs.css'

export function WorkflowWorkspace({ workflow, onBack, onDirty, onNotice }: { workflow: Workflow; onBack: () => void; onDirty: (value: boolean) => void; onNotice: (message: string) => void }) {
  const runs = useWorkflowRuns(workflow.id)
  const workflows = useWorkflows()
  const [dirty, setDirty] = useState(false)
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState(false)
  const reportDirty = useCallback((value: boolean) => { setDirty(value); onDirty(value) }, [onDirty])
  return <section className={`management-page workflow-workspace ${editing ? 'workflow-workspace-editing' : ''}`}><header className="management-toolbar workflow-workspace-toolbar"><div className="workflow-workspace-heading"><Button className="workflow-back-button" variant="outline" onClick={async () => { if (dirty && !await confirmAction('放弃未保存的修改并返回工作流？')) return; onDirty(false); onBack() }}><FontAwesomeIcon icon={faArrowLeft} />返回工作流</Button><div><h2>{workflow.name}</h2><span className="muted">{workflow.kind === 'audio' ? '声音生成 / 克隆' : '图片生成'} · 产物进入公共素材库</span></div></div><div className="button-row">
    {!editing && <Button variant="outline" disabled={checking || !workflow.form} onClick={async () => { if (dirty && !await confirmAction('放弃未提交的输入并编辑应用？')) return; reportDirty(false); setEditing(true) }}><FontAwesomeIcon icon={faPen} />编辑应用</Button>}
    <Button variant="outline" disabled={checking} onClick={async () => { if (dirty && !await confirmAction('重新检测可能更新输入字段，确定继续？')) return; setChecking(true); try { await workflows.inspect(workflow.id) } catch (error) { onNotice(error instanceof Error ? error.message : '检测失败') } finally { setChecking(false) } }}><FontAwesomeIcon icon={faRotateRight} />{checking ? '检测中' : '重新检测'}</Button>
  </div></header>{workflow.error && <p className="field-error" role="alert">{workflow.error}</p>}
    {editing ? <WorkflowApplicationEditor key={`${workflow.id}-${workflow.checkedAt}-${workflow.application?.updatedAt}`} workflow={workflow} onDirty={reportDirty}
      onCancel={async () => { if (dirty && !await confirmAction('放弃未保存的应用配置？')) return; reportDirty(false); setEditing(false) }}
      onSave={async (fields) => { if (!workflow.checkedAt) throw new Error('请先检测工作流'); await workflows.saveApplication({ id: workflow.id, expectedCheckedAt: workflow.checkedAt, expectedUpdatedAt: workflow.application?.updatedAt ?? null, fields }); setEditing(false) }} />
      : <>{workflow.application?.needsReview && <p className="field-error" role="alert">工作流输入已变化，请进入“编辑应用”复核并保存后运行。</p>}
    <div className="workflow-workspace-columns"><section><h3>运行输入</h3><WorkflowInputs key={`${workflow.id}-${workflow.checkedAt}-${workflow.application?.updatedAt}`} workflow={workflow}
      onDirty={reportDirty} onChooseVoice={runs.chooseVoice} onChooseMedia={(key) => runs.chooseMedia(workflow.id, key)} onRun={async (values, instance) => {
        return runs.start(workflow, values, instance)
      }} /></section><WorkflowHistory workflowId={workflow.id} onNotice={onNotice} /></div></>}
  </section>
}
