import type { WorkflowRun } from '../../../../shared/contracts/workflow-runs'

interface MonitoredRuns {
  list(): WorkflowRun[]
  refresh(id: string): Promise<WorkflowRun>
  canMonitor?(): boolean
}

export class WorkflowRunMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private readonly retry = new Map<string, { attempts: number; after: number }>()
  private readonly active = new Set<string>()
  constructor(private readonly runs: MonitoredRuns) {}
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.tick()
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null }
  private tick(): void {
    if (this.stopped) return
    for (const run of this.runs.canMonitor?.() === false ? [] : this.runs.list()) {
      const missingMetrics = ['success', 'failed'].includes(run.status) && (!run.metricsCheckedAt || run.points == null || run.executionSeconds == null)
      if (!run.taskId || !missingMetrics && !['running', 'unknown', 'download-error'].includes(run.status) || this.active.has(run.id)) continue
      const retry = this.retry.get(run.id)
      // 只查询已有远端任务。保存失败最多自动重试三次，绝不调用创建或重新生成。
      if ((run.status === 'download-error' || missingMetrics) && retry && (retry.attempts >= 3 || retry.after > Date.now())) continue
      if (this.active.size >= 3) break
      this.active.add(run.id)
      void this.runs.refresh(run.id).then((updated) => {
        if (updated.status === 'download-error' || missingMetrics && (!updated.metricsCheckedAt || updated.points == null || updated.executionSeconds == null)) {
          const attempts = (this.retry.get(run.id)?.attempts ?? 0) + 1
          this.retry.set(run.id, { attempts, after: Date.now() + 5000 * 2 ** attempts })
        } else this.retry.delete(run.id)
      }).catch(() => { /* 网络失败留待下一轮查询，不重建任务。 */ }).finally(() => this.active.delete(run.id))
    }
    this.timer = setTimeout(() => this.tick(), 4000)
    this.timer.unref()
  }
}
