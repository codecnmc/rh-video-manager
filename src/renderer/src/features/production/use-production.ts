import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DialoguePlan, DialogueProduction, ProductionScope, SaveCharacterVoice } from '@contracts/production'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useSpeechCapabilities(enabled = true) {
  return useQuery({ queryKey: ['production-capabilities'], queryFn: async () => unwrap(await desktop().productionCapabilities()),
    enabled, retry: false, refetchInterval: 3000 })
}

export function useProduction(scope: ProductionScope, enabled: boolean) {
  const client = useQueryClient()
  const key = ['dialogue-production', scope.projectId, scope.draftId]
  const capabilities = useSpeechCapabilities(enabled)
  const query = useQuery({ queryKey: key, queryFn: async () => unwrap(await desktop().loadProduction(scope)),
    enabled: enabled && capabilities.isSuccess && capabilities.data.length > 0, retry: false, refetchInterval: 1500 })
  async function refresh() { await query.refetch(); await client.invalidateQueries({ queryKey: ['assets'] }) }
  return { ...query, capabilities,
    save: async (plan: DialoguePlan) => {
      const result = unwrap(await desktop().saveProduction(plan))
      client.setQueryData<DialogueProduction>(key, (current) => ({ plan: result, takes: current?.takes ?? [], voices: current?.voices ?? { projectId: scope.projectId, revision: 0, bindings: [] } }))
      return result
    },
    saveVoice: async (binding: SaveCharacterVoice['binding'], revision: number) => {
      unwrap(await desktop().saveCharacterVoice({ ...scope, revision, binding }))
      await query.refetch()
    },
    generate: async (lineId: string, revision: number) => { unwrap(await desktop().generateDialogue({ ...scope, lineId, revision })); await refresh() },
    cancel: async (takeId: string) => { unwrap(await desktop().cancelDialogue({ ...scope, takeId })); await refresh() },
    adopt: async (takeId: string, revision: number) => { unwrap(await desktop().adoptDialogue({ ...scope, takeId, revision })); await refresh() }
  }
}
