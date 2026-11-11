import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { WorkflowRepository } from '../../modules/workflows'
import { workflowKindSchema, workflowFormSchema, workflowApplicationSchema, type Workflow } from '../../../shared/contracts/workflows'

const workflowSchema = z.object({
  application: workflowApplicationSchema.nullable().optional(), kind: workflowKindSchema.default('video'), form: workflowFormSchema.nullable().optional(), id: z.string().uuid(), name: z.string(), workflowId: z.string(), enabled: z.boolean(), isDefault: z.boolean(),
  checkedAt: z.string().nullable(), error: z.string(), capabilities: z.object({
    status: z.enum(['checking', 'ready', 'failed']), sampling: z.boolean().nullable(), draft: z.boolean().nullable(),
    final: z.boolean().nullable(), combat: z.boolean().optional(), unclassifiedOutputs: z.number()
  }).nullable()
})

export class SqliteWorkflowRepository implements WorkflowRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(): Workflow[] {
    return this.database.prepare('SELECT data, account_id, is_default FROM workflows ORDER BY is_default DESC, rowid').all().map((row) => {
      const workflow = workflowSchema.parse(JSON.parse(String(row.data)) as unknown)
      const accountId = typeof row.account_id === 'string' ? row.account_id : null
      return { ...workflow, accountId, isDefault: accountId !== null && row.is_default === 1, enabled: accountId !== null && workflow.enabled }
    })
  }
  save(workflow: Workflow): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (workflow.isDefault) this.database.prepare("UPDATE workflows SET is_default = 0 WHERE account_id = ? AND COALESCE(json_extract(data, '$.kind'), 'video') = ?").run(workflow.accountId, workflow.kind ?? 'video')
      this.database.prepare(`INSERT INTO workflows (id, account_id, workflow_id, is_default, data) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, workflow_id=excluded.workflow_id, is_default=excluded.is_default, data=excluded.data`)
        .run(workflow.id, workflow.accountId, workflow.workflowId, Number(workflow.isDefault), JSON.stringify(workflow))
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  remove(id: string): void { this.database.prepare('DELETE FROM workflows WHERE id = ?').run(id) }
}
