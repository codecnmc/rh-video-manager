import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SaveAccount } from '@contracts/accounts'
import { desktop, unwrap } from '@/shared/lib/desktop'

// 仅由常驻的账号池状态栏挂载；轮询必须查询远端，不能只重读 SQLite 快照。
export function useAccountPoolSync(enabled: boolean) {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['account-pool-sync'],
    queryFn: async () => {
      const pool = unwrap(await desktop().refreshAccounts(null))
      client.setQueryData(['accounts'], pool)
      return pool
    },
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false
  })
}

export function useAccounts() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['accounts'], queryFn: async () => unwrap(await desktop().listAccounts()), retry: false })
  const update = (pool: NonNullable<typeof query.data>) => { client.setQueryData(['accounts'], pool); return pool }
  return { ...query,
    save: async (input: SaveAccount) => update(unwrap(await desktop().saveAccount(input))),
    remove: async (id: string) => update(unwrap(await desktop().deleteAccount(id))),
    refresh: async (id: string | null = null) => update(unwrap(await desktop().refreshAccounts(id)))
  }
}
