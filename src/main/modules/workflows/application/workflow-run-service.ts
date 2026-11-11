import { startWorkflowRunSchema, type StartWorkflowRun, type WorkflowRun } from '../../../../shared/contracts/workflow-runs'
import { WorkflowRejectedError, type WorkflowRunContext, type WorkflowRunRepository } from '../ports/workflow-runs'

const pending = (run: WorkflowRun) => ['preparing', 'submitting', 'unknown', 'running'].includes(run.status)

export class WorkflowRunService {
  private readonly active = new Set<string>()
  private stopped = false
  private paused = false
  constructor(private readonly repository: WorkflowRunRepository, private readonly context: WorkflowRunContext) {
    for (const run of repository.list()) if (run.status === 'preparing' || run.status === 'submitting') {
      repository.save({ ...run, status: run.status === 'submitting' ? 'unknown' : 'failed', message: '上次操作已中断；不会自动重新提交，请核对远端任务。' })
    }
    for (const run of repository.list()) if (run.status === 'downloading') repository.save({ ...run, status: 'download-error', message: '上次保存已中断，将继续获取原任务结果' })
  }
  list(workflowId?: string) { return this.repository.list().filter((run) => !run.hiddenAt && (!workflowId || run.workflowId === workflowId)) }
  referencesAsset(id: string): boolean { return this.repository.list().some((run) => run.assets.some((asset) => asset.id === id) || Object.values(run.input?.values ?? {}).some((value) => typeof value === 'object' && value.assetId === id)) }
  removeFailed(id: string, expectedUpdatedAt: string): void {
    if (this.stopped || this.paused) throw new Error('应用正在退出或迁移数据')
    const run = this.list().find((item) => item.id === id)
    if (!run || run.updatedAt !== expectedUpdatedAt) throw new Error('记录已更新，请重新选择')
    if (run.status !== 'failed' || this.active.has(id)) throw new Error('仅可移除已确认失败且未在处理的记录')
    this.repository.save({ ...run, hiddenAt: new Date().toISOString() })
  }
  hasPending(accountId?: string, workflowId?: string) { return this.list(workflowId).some((run) => (!accountId || run.accountId === accountId) && pending(run)) }
  hasActivity() { return this.active.size > 0 }
  stop(): void { this.stopped = true }
  canMonitor(): boolean { return !this.stopped && !this.paused }
  pauseForSnapshot(): () => void {
    if (this.hasActivity()) throw new Error('工作流正在提交或保存结果，请稍后导出')
    this.paused = true
    return () => { this.paused = false }
  }
  reservationCount(accountId: string, excludeId?: string) { return this.list().filter((run) => run.id !== excludeId && run.accountId === accountId && pending(run)).length }
  async start(raw: StartWorkflowRun): Promise<WorkflowRun> {
    if (this.stopped || this.paused) throw new Error('应用正在退出或迁移数据，请稍后运行')
    const input = startWorkflowRunSchema.parse(raw)
    const duplicate = this.repository.list().find((run) => run.id === input.requestId)
    if (duplicate) {
      if (duplicate.workflowId !== input.workflowId) throw new Error('请求标识已用于其他工作流')
      return duplicate
    }
    const workflow = this.context.workflow(input.workflowId)
    if (workflow.kind === 'image') throw new Error('图片工作流模式已停用，无法提交新任务')
    if (!workflow.accountId || !workflow.enabled || workflow.kind !== 'audio') throw new Error('请选择启用的声音工作流')
    if (!workflow.form || !workflow.checkedAt || workflow.checkedAt !== input.expectedCheckedAt) throw new Error('工作流输入已变化，请重新检测并填写')
    if (workflow.form.fields.some((field) => /^input-\d+$/.test(field.key))) throw new Error('字段识别已升级，请重新检测一次工作流')
    if (workflow.error || workflow.application?.needsReview) throw new Error('请先完成工作流检测及应用字段复核')
    if ((workflow.application?.updatedAt || null) !== (input.expectedApplicationUpdatedAt ?? null)) throw new Error('应用配置已变化，请重新打开后填写')
    const values = { ...input.values }
    if (Object.keys(values).some((key) => !workflow.form!.fields.some((field) => field.key === key))) throw new Error('输入包含未知字段，请重新打开应用')
    for (const field of workflow.form.fields) values[field.key] ??= workflow.application?.fields.find((item) => item.key === field.key)?.defaultValue ?? field.defaultValue
    // 固定参数由主进程配置覆盖，不能通过界面请求悄悄修改。
    for (const field of workflow.application?.fields ?? []) if (field.visibility === 'fixed') values[field.key] = field.defaultValue
    const now = new Date().toISOString()
    const run: WorkflowRun = { id: input.requestId, workflowId: workflow.id, workflowName: workflow.name, accountId: workflow.accountId, kind: workflow.kind,
      taskId: '', status: 'preparing', createdAt: now, updatedAt: now, message: '正在检查输入及账号容量', assets: [], input: { values: structuredClone(values), instance: input.instance, fields: structuredClone(workflow.form.fields) } }
    this.repository.save(run)
    this.active.add(run.id)
    try {
      await this.context.assertCapacity(run.accountId, run.id)
      if (this.stopped || this.paused) throw new Error('提交已停止，未创建任务')
      const execution = await this.context.prepare(workflow, values)
      if (JSON.stringify(execution.form.fields) !== JSON.stringify(workflow.form.fields)) throw new Error('线上输入已更新，请重新检测后填写')
      const current = this.context.workflow(workflow.id)
      if (current.checkedAt !== workflow.checkedAt || current.application?.updatedAt !== workflow.application?.updatedAt || current.error || !current.enabled) throw new Error('工作流配置已变化，请重新打开后运行')
      await this.context.assertCapacity(run.accountId, run.id)
      if (this.stopped || this.paused) throw new Error('提交已停止，未创建任务')
      // 所有输入预检和上传在进入 submitting 前完成；submit 内不重试创建。
      run.status = 'submitting'; run.message = '正在上传与提交，请勿重复操作'; this.repository.save(run)
      run.taskId = await execution.submit(input.instance)
      run.status = 'running'; run.message = '任务已受理，正在自动获取结果'
    } catch (error) {
      run.status = run.status === 'submitting' && !(error instanceof WorkflowRejectedError) ? 'unknown' : 'failed'
      run.message = run.status === 'unknown' ? '提交受理不明，可能已计费；请核对平台，不会自动重提或换账号。' : error instanceof Error ? error.message : '操作失败，未重新提交'
    } finally { this.active.delete(run.id); run.updatedAt = new Date().toISOString(); if (!this.stopped) this.repository.save(run) }
    return run
  }
  async refresh(id: string): Promise<WorkflowRun> {
    const run = this.list().find((item) => item.id === id)
    if (!run) throw new Error('运行记录不存在')
    if (this.stopped || this.paused || !run.taskId || (run.status === 'success' || run.status === 'failed') && run.metricsCheckedAt && run.points != null && run.executionSeconds != null || this.active.has(id)) return run
    this.active.add(id)
    try {
      const result = await this.context.query(run)
      if (this.stopped) return run
      if (result.points != null) run.points = result.points
      if (result.executionSeconds != null) run.executionSeconds = result.executionSeconds
      if (result.status !== 'running') run.metricsCheckedAt = new Date().toISOString()
      // 旧终态记录仅补查费用和执行时长，不重新归档或改变原终态。
      if (run.status === 'success' || run.status === 'failed') return run
      if (result.status === 'running') { run.status = 'running'; run.message = '任务仍在排队或运行' }
      else if (result.status === 'failed') { run.status = 'failed'; run.message = '远端任务失败，请在平台核对；不会自动重提' }
      else {
        run.status = 'downloading'; run.message = '生成已完成，正在保存结果'; this.repository.save(run)
        if (!result.outputs.length) throw new Error('远端未返回支持的图片或音频产物，请到平台核对')
        for (let index = run.assets.length; index < result.outputs.length; index++) {
          const asset = await this.context.archive(run, result.outputs[index]!, index)
          if (this.stopped) return run
          run.assets.push(asset); this.repository.save(run)
        }
        run.status = 'success'; run.message = '产物已存入公共素材库'
      }
    } catch {
      if (run.status === 'downloading' || run.status === 'download-error') { run.status = 'download-error'; run.message = '结果尚未保存，可重试保存；不会重新生成' }
      else run.message = '连接暂时中断，正在自动重连'
    }
    finally { this.active.delete(id); run.updatedAt = new Date().toISOString(); if (!this.stopped) this.repository.save(run) }
    return run
  }
}
