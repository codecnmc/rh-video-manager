import type { DatabaseSync } from 'node:sqlite'
import { workflowRunSchema, type WorkflowRun } from '../../../shared/contracts/workflow-runs'
import type { WorkflowRunRepository } from '../../modules/workflows'

export class SqliteWorkflowRunRepository implements WorkflowRunRepository {
  constructor(private readonly database: DatabaseSync) {}
  list() { return this.database.prepare('SELECT data FROM workflow_runs ORDER BY rowid DESC').all().map((row) => workflowRunSchema.parse(JSON.parse(String(row.data)) as unknown)) }
  save(run: WorkflowRun) { this.database.prepare('INSERT INTO workflow_runs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id, JSON.stringify(workflowRunSchema.parse(run))) }
}
