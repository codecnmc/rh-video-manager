import type { WorkflowGateway } from '../../modules/workflows'
import { inspectWorkflowPreview } from './workflow-preview'

export class RunningHubWorkflowGateway implements WorkflowGateway {
  async inspect(workflowId: string, credential: string) {
    const response = await fetch('https://www.runninghub.cn/api/openapi/getJsonApiFormat', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ apiKey: credential, workflowId })
    })
    if (!response.ok) throw new Error('工作流查询失败')
    const text = await response.text()
    if (text.length > 2 * 1024 * 1024) throw new Error('工作流响应过大')
    return inspectWorkflowPreview(JSON.parse(text) as unknown).capabilities
  }
}
