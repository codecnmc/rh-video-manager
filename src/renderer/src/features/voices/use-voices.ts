import { useQuery, useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'
import type { CreateVoice, RenameVoice } from '@contracts/voices'

export function useVoices() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['public-voices'], queryFn: async () => unwrap(await desktop().listPublicVoices()), retry: false, refetchInterval: 5000 })
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['public-voices'] }); await client.invalidateQueries({ queryKey: ['assets'] }) }
  return { ...query,
    rename: async (input: RenameVoice) => { const voice = unwrap(await desktop().renamePublicVoice(input)); await refresh(); return voice },
    importAudio: async () => { const result = unwrap(await desktop().importPublicVoices()); await refresh(); return result },
    fromAsset: async (input: CreateVoice) => { const voice = unwrap(await desktop().createPublicVoice(input)); await refresh(); return voice }
  }
}
