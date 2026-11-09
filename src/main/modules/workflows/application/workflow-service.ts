import type { SaveWorkflow, Workflow, WorkflowTemplate } from '../../../../shared/contracts/workflows'
import type { WorkflowGateway, WorkflowRepository } from '../ports/workflows'

export class WorkflowService {
  constructor(private readonly repository: WorkflowRepository, private readonly gateway: WorkflowGateway, private readonly id: () => string,
    private readonly templateContent = '', private readonly acceleratedTemplateContent = '') {}
  exportTemplate(template: WorkflowTemplate = 'standard'): string {
    const content = template === 'accelerated' ? this.acceleratedTemplateContent : this.templateContent
    if (!content) throw new Error('工作流模板尚未配置')
    return content
  }
  list(): Workflow[] { return this.repository.list() }
  get(id: string): Workflow {
    const workflow = this.list().find((entry) => entry.id === id)
    if (!workflow) throw new Error('工作流配置不存在')
    return workflow
  }
  forAccount(id: string, accountId: string): Workflow {
    const workflow = this.get(id)
    if (workflow.accountId !== accountId) throw new Error('工作流不属于所选账号，不能跨账号调用私有工作流')
    if (!workflow.enabled) throw new Error('工作流已停用')
    return workflow
  }
  save(input: SaveWorkflow): Workflow[] {
    const existing = input.id ? this.get(input.id) : null
    if (this.list().some((entry) => entry.id !== input.id && entry.accountId === input.accountId && entry.workflowId === input.workflowId)) throw new Error('该账号的工作流 ID 已存在')
    const unchanged = existing?.workflowId === input.workflowId && existing.accountId === input.accountId
    this.repository.save({ id: input.id ?? this.id(), accountId: input.accountId, name: input.name, workflowId: input.workflowId,
      enabled: input.enabled, isDefault: input.isDefault, capabilities: unchanged ? existing?.capabilities ?? null : null,
      checkedAt: unchanged ? existing?.checkedAt ?? null : null, error: unchanged ? existing?.error ?? '' : '' })
    return this.list()
  }
  remove(id: string): Workflow[] { this.get(id); this.repository.remove(id); return this.list() }
  async inspect(id: string, credential: string): Promise<Workflow[]> {
    const original = this.get(id)
    try {
      const capabilities = await this.gateway.inspect(original.workflowId, credential)
      const current = this.list().find((entry) => entry.id === id)
      if (current?.workflowId === original.workflowId && current.accountId === original.accountId) this.repository.save({ ...current, capabilities, checkedAt: new Date().toISOString(), error: '' })
    } catch {
      const current = this.list().find((entry) => entry.id === id)
      if (current?.workflowId === original.workflowId && current.accountId === original.accountId) this.repository.save({ ...current, capabilities: null, error: '检测失败，请核对工作流 ID、账号权限或网络' })
    }
    return this.list()
  }
}
