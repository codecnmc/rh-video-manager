import type { PreviewEvent, PreviewSnapshot } from '../../../../shared/contracts/preview'
import type { TaskDiagnostic } from '../../../../shared/contracts/task-diagnostics'

export interface PreviewSession {
  snapshot(): PreviewSnapshot
  start(): void
  stop(): void
  cancel(): Promise<void>
}

export interface PreviewSessionOptions {
  initial: PreviewSnapshot
  credential: string
  workflowDefinition?: string
  emit: (event: PreviewEvent) => void
  diagnose?: (entry: TaskDiagnostic) => void
}

export type PreviewSessionFactory = (options: PreviewSessionOptions) => PreviewSession
