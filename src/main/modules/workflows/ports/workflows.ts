import type { Workflow, WorkflowFormDefinition } from '../../../../shared/contracts/workflows'
import type { PreviewCapabilities } from '../../../../shared/contracts/preview'

export interface WorkflowRepository {
  list(): Workflow[]
  save(workflow: Workflow): void
  remove(id: string): void
}
export interface WorkflowGateway { inspect(workflowId: string, credential: string): Promise<PreviewCapabilities>; inspectForm?(workflowId: string, credential: string): Promise<WorkflowFormDefinition> }
export class WorkflowInspectionError extends Error {}
