import type { StartWorkflowRun, WorkflowRun } from '../../../../shared/contracts/workflow-runs'
import type { Workflow, WorkflowFormDefinition } from '../../../../shared/contracts/workflows'

export interface WorkflowRunRepository {
  list(): WorkflowRun[]
  save(run: WorkflowRun): void
}
export interface WorkflowExecution {
  form: WorkflowFormDefinition
  submit(instance: StartWorkflowRun['instance']): Promise<string>
}
export interface WorkflowRunContext {
  workflow(id: string): Workflow
  assertCapacity(accountId: string, currentRunId?: string): Promise<void>
  prepare(workflow: Workflow, values: StartWorkflowRun['values']): Promise<WorkflowExecution>
  query(run: WorkflowRun): Promise<{ status: 'running' | 'success' | 'failed'; points?: string | null; executionSeconds?: number | null; outputs: { url: string; kind: 'audio' | 'image'; extension: string }[] }>
  archive(run: WorkflowRun, output: { url: string; kind: 'audio' | 'image'; extension: string }, index: number): Promise<WorkflowRun['assets'][number]>
}
export class WorkflowRejectedError extends Error {}
