import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SaveWorkflow, Workflow } from '@contracts/workflows'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useWorkflows() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['workflows'], queryFn: async () => unwrap(await desktop().listWorkflows()), retry: false })
  const update = (workflows: Workflow[]) => { client.setQueryData(['workflows'], workflows); return workflows }
  return { ...query,
    downloadTemplate: async () => unwrap(await desktop().exportWorkflowTemplate()),
    save: async (input: SaveWorkflow) => update(unwrap(await desktop().saveWorkflow(input))),
    remove: async (id: string) => update(unwrap(await desktop().deleteWorkflow(id))),
    inspect: async (id: string) => update(unwrap(await desktop().inspectWorkflow(id)))
  }
}
