import { useQuery } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function usePreferences() {
  return useQuery({ queryKey: ['app-preferences'], queryFn: async () => unwrap(await desktop().appPreferences()), retry: false })
}
