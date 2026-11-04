import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConsumptionFilter } from '@contracts/consumption'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useConsumption(filter: ConsumptionFilter) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['consumption-ledger', filter],
    queryFn: async () => unwrap(await desktop().consumptionLedger(filter)), retry: false, refetchInterval: 10_000 })
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: async () => unwrap(await desktop().loadWorkspace()), retry: false })
  const refresh = useMutation({
    mutationFn: async (ids: string[]) => {
      let failed = 0
      // 逐笔查询且不自动重试，避免废弃接口异常时对账号发起密集请求。
      for (const id of ids) {
        try { unwrap(await desktop().refreshTaskConsumption(id)) } catch { failed += 1 }
      }
      return { total: ids.length, failed }
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['consumption-ledger'] })
      await client.invalidateQueries({ queryKey: ['previews'] })
    }
  })
  return { ...query, workspace, refresh }
}
