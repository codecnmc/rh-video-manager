import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SaveWorkflow, SaveWorkflowApplication, Workflow, WorkflowTemplate } from '@contracts/workflows'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useWorkflows() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['workflows'], queryFn: async () => unwrap(await desktop().listWorkflows()), retry: false })
  const update = (workflows: Workflow[]) => { client.setQueryData(['workflows'], workflows); return workflows }
  return { ...query,
    downloadTemplate: async (template: WorkflowTemplate = 'accelerated') => unwrap(await desktop().exportWorkflowTemplate(template)),
    save: async (input: SaveWorkflow) => update(unwrap(await desktop().saveWorkflow(input))),
    remove: async (id: string) => update(unwrap(await desktop().deleteWorkflow(id))),
    saveApplication: async (input: SaveWorkflowApplication) => update(unwrap(await desktop().saveWorkflowApplication(input))),
    inspect: async (id: string) => update(unwrap(await desktop().inspectWorkflow(id)))
  }
}
