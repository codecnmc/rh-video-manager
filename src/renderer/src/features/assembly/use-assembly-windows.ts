import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useAssemblyWindows() {
  const client = useQueryClient()
  const state = useQuery({ queryKey: ['assembly-windows'], queryFn: async () => unwrap(await desktop().assemblyWindowState()),
    retry: false, refetchInterval: 1000 })
  useEffect(() => desktop().onAssemblyWindowsChanged(() => {
    void client.invalidateQueries({ queryKey: ['assembly-windows'] })
  }), [client])
  return state
}
