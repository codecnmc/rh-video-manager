import { saveWorkflowApplicationSchema, type SaveWorkflowApplication, type SaveWorkflow, type Workflow, type WorkflowTemplate } from '../../../../shared/contracts/workflows'
import { reconcileWorkflowApplication, suggestWorkflowApplication } from './workflow-application'
import type { WorkflowGateway, WorkflowRepository } from '../ports/workflows'
import { WorkflowInspectionError } from '../ports/workflows'

export class WorkflowService {
  constructor(private readonly repository: WorkflowRepository, private readonly gateway: WorkflowGateway, private readonly id: () => string,
    _legacyTemplateContent = '', private readonly acceleratedTemplateContent = '') {}
  exportTemplate(_template: WorkflowTemplate = 'accelerated'): string {
    const content = this.acceleratedTemplateContent
    if (!content) throw new Error('工作流模板尚未配置')
    return content
  }
  list(): Workflow[] { return this.repository.list().map((workflow) => ({ ...workflow,
    application: workflow.application ?? (workflow.form ? suggestWorkflowApplication(workflow.form) : null) })) }
  get(id: string): Workflow {
    const workflow = this.list().find((entry) => entry.id === id)
    if (!workflow) throw new Error('工作流配置不存在')
    return workflow
  }
  forAccount(id: string, accountId: string): Workflow {
    const workflow = this.get(id)
    if (workflow.accountId !== accountId) throw new Error('工作流不属于所选账号，不能跨账号调用私有工作流')
    if ((workflow.kind ?? 'video') !== 'video') throw new Error('所选工作流不是视频生成类型')
    if (!workflow.enabled) throw new Error('工作流已停用')
    return workflow
  }
  save(input: SaveWorkflow): Workflow[] {
    const existing = input.id ? this.get(input.id) : null
    if (this.list().some((entry) => entry.id !== input.id && entry.accountId === input.accountId && entry.workflowId === input.workflowId)) throw new Error('该账号的工作流 ID 已存在')
    const unchanged = existing?.workflowId === input.workflowId && existing.accountId === input.accountId && (existing.kind ?? 'video') === (input.kind ?? 'video')
    this.repository.save({ application: unchanged ? existing?.application ?? null : null, kind: input.kind ?? 'video', form: unchanged ? existing?.form ?? null : null, id: input.id ?? this.id(), accountId: input.accountId, name: input.name, workflowId: input.workflowId,
      enabled: input.enabled, isDefault: input.isDefault, capabilities: unchanged ? existing?.capabilities ?? null : null,
      checkedAt: unchanged ? existing?.checkedAt ?? null : null, error: unchanged ? existing?.error ?? '' : '' })
    return this.list()
  }
  async saveAndInspect(input: SaveWorkflow, credential: string): Promise<Workflow[]> {
    const previous = input.id ? this.get(input.id) : null
    const saved = this.save(input)
    const workflow = saved.find((item) => item.accountId === input.accountId && item.workflowId === input.workflowId)!
    if (!previous || previous.workflowId !== input.workflowId || previous.accountId !== input.accountId || (previous.kind ?? 'video') !== (input.kind ?? 'video')) return this.inspect(workflow.id, credential)
    return saved
  }
  remove(id: string): Workflow[] { this.get(id); this.repository.remove(id); return this.list() }
  saveApplication(raw: SaveWorkflowApplication): Workflow[] {
    const input = saveWorkflowApplicationSchema.parse(raw)
    const workflow = this.get(input.id)
    if (!workflow.form || workflow.kind === 'video' || workflow.checkedAt !== input.expectedCheckedAt || (workflow.application?.updatedAt ?? null) !== input.expectedUpdatedAt) throw new Error('工作流或应用配置已更新，请重新打开编辑')
    if (input.fields.length !== workflow.form.fields.length || new Set(input.fields.map((field) => field.key)).size !== input.fields.length) throw new Error('请配置全部输入字段且不要重复')
    for (const field of workflow.form.fields) {
      const configured = input.fields.find((item) => item.key === field.key)
      if (!configured || typeof configured.defaultValue !== typeof field.defaultValue) throw new Error('默认值类型与原字段不一致')
      if (field.type !== 'text' && configured.control !== 'native' || field.type === 'text' && configured.control === 'native') throw new Error('控件类型与原字段不一致')
      if ((field.type === 'audio' || field.type === 'image') && configured.visibility === 'fixed') throw new Error('素材输入不能隐藏为固定参数')
    }
    const previousTime = Date.parse(workflow.application?.updatedAt || '')
    const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString()
    this.repository.save({ ...workflow, application: { fields: input.fields, updatedAt, needsReview: false } })
    return this.list()
  }
  async inspect(id: string, credential: string): Promise<Workflow[]> {
    const original = this.get(id)
    try {
      const video = (original.kind ?? 'video') === 'video'
      const capabilities = video ? await this.gateway.inspect(original.workflowId, credential) : null
      const form = video ? null : await this.gateway.inspectForm?.(original.workflowId, credential)
      if (!video && !form) throw new Error('工作流表单识别不可用')
      const current = this.list().find((entry) => entry.id === id)
      if (current?.workflowId === original.workflowId && current.accountId === original.accountId && (current.kind ?? 'video') === (original.kind ?? 'video')) {
        const changed = JSON.stringify(current.form?.fields) !== JSON.stringify(form?.fields)
        const application = !form ? null : changed && current.form ? reconcileWorkflowApplication(form, current.application, current.form) : current.application ?? suggestWorkflowApplication(form)
        this.repository.save({ ...current, application, capabilities, form: form ?? null, checkedAt: new Date().toISOString(), error: '' })
      }
    } catch (error) {
      const current = this.list().find((entry) => entry.id === id)
      if (current?.workflowId === original.workflowId && current.accountId === original.accountId && (current.kind ?? 'video') === (original.kind ?? 'video')) this.repository.save({ ...current, capabilities: null, error: error instanceof WorkflowInspectionError ? error.message : '检测失败，请核对工作流 ID、账号权限或网络' })
    }
    return this.list()
  }
}
