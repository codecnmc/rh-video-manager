import { inspectWorkflowForm } from './workflow-form'
import type { WorkflowGateway } from '../../modules/workflows'
import { WorkflowInspectionError } from '../../modules/workflows'
import { z } from 'zod'
import { inspectWorkflowPreview } from './workflow-preview'

export class RunningHubWorkflowGateway implements WorkflowGateway {
  private async read(workflowId: string, credential: string): Promise<unknown> {
    const response = await fetch('https://www.runninghub.cn/api/openapi/getJsonApiFormat', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ apiKey: credential, workflowId })
    })
    if (!response.ok) throw new WorkflowInspectionError(`工作流查询失败（HTTP ${response.status}）`)
    const text = await response.text()
    if (text.length > 2 * 1024 * 1024) throw new Error('工作流响应过大')
    const value: unknown = JSON.parse(text)
    const status = z.object({ code: z.number() }).safeParse(value)
    if (status.success && status.data.code !== 0) throw new WorkflowInspectionError(`平台拒绝读取工作流（业务码 ${status.data.code}），请核对权限及线上 ID`)
    return value
  }
  async inspect(workflowId: string, credential: string) { return inspectWorkflowPreview(await this.read(workflowId, credential)).capabilities }
  async inspectForm(workflowId: string, credential: string) {
    const response = await this.read(workflowId, credential)
    try { return inspectWorkflowForm(response) }
    catch { throw new WorkflowInspectionError('线上返回的节点输入结构暂不受支持，请提供导出的 API JSON 以核对') }
  }
}
