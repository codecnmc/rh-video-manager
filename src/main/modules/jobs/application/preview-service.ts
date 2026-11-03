import { randomUUID } from 'node:crypto'
import type { ConnectPreview, PreviewEvent, PreviewSnapshot } from '../../../../shared/contracts/preview'
import type { PreviewSession, PreviewSessionFactory } from '../ports/preview-session'

export class PreviewService {
  private readonly sessions = new Map<string, PreviewSession>()

  constructor(private readonly factory: PreviewSessionFactory, private readonly emit: (event: PreviewEvent) => void) {}

  connect(input: ConnectPreview, remote: { workflowId: string; credential: string }): PreviewSnapshot {
    const existing = [...this.sessions.values()].find((session) => session.snapshot().taskId === input.taskId)
    if (existing) throw new Error('该任务已在监听，请先断开原监听再重新关联')
    if (this.sessions.size >= 12) throw new Error('最多同时保留 12 个监听任务，请移除旧监听')
    const initial: PreviewSnapshot = {
      id: randomUUID(), taskId: input.taskId, workflowId: remote.workflowId,
      workflowConfigId: input.workflowConfigId, accountId: input.accountId,
      capabilities: { status: 'checking', sampling: null, draft: null, final: null, unclassifiedOutputs: 0 },
      projectId: input.projectId, draftId: input.draftId,
      connection: 'connecting', remoteStatus: 'unknown', stage: '正在查询远端任务',
      step: 0, total: 0, samplingStep: 0, samplingTotal: 0,
      sampling: null, draft: null, final: null, notice: '', cancelState: 'none'
    }
    const session = this.factory({ initial, credential: remote.credential, emit: this.emit })
    this.sessions.set(initial.id, session)
    session.start()
    return session.snapshot()
  }

  get(id: string): PreviewSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('任务监听不存在')
    return session
  }

  list(): PreviewSnapshot[] { return [...this.sessions.values()].map((session) => session.snapshot()) }

  restore(initial: PreviewSnapshot, credential: string, workflowDefinition?: string): void {
    if (this.sessions.has(initial.id)) return
    const session = this.factory({ initial, credential, workflowDefinition, emit: this.emit })
    this.sessions.set(initial.id, session)
    session.start()
  }

  disconnect(id: string): void {
    this.get(id).stop()
    this.sessions.delete(id)
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.stop()
    this.sessions.clear()
  }
}
