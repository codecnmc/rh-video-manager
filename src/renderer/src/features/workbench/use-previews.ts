import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PreviewSnapshot } from '@contracts/preview'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function usePreviews() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['previews'], queryFn: async () => unwrap(await desktop().listPreviews()), retry: false })
  useEffect(() => {
    if (!window.workbench) return
    const unsubscribe = desktop().onPreview((event) => {
      if (event.type === 'state' && event.state.connection === 'completed') {
        void client.invalidateQueries({ queryKey: ['accounts'] })
        void client.invalidateQueries({ queryKey: ['account-pool-sync'] }, { cancelRefetch: false })
      }
      if (event.type === 'state' && event.state.finalArchive?.status === 'ready') {
        void client.invalidateQueries({ queryKey: ['assets'] })
        void client.invalidateQueries({ queryKey: ['asset-categories'] })
      }
      client.setQueryData<PreviewSnapshot[]>(['previews'], (previous = []) => {
        if (event.type === 'state' && !previous.some((item) => item.id === event.state.id)) return [{ ...event.state, sampling: null, draft: null, final: null }, ...previous]
        return previous.map((item) => {
          if (event.type === 'state') return item.id === event.state.id ? { ...item, ...event.state } : item
          return item.id === event.id ? { ...item, [event.kind]: event.media,
            ...(event.kind === 'final' && item.draft?.source === event.media.source ? { draft: null } : {}) } : item
        })
      })
    })
    return unsubscribe
  }, [client])
  async function disconnect(id: string) {
    unwrap(await desktop().disconnectPreview(id))
    client.setQueryData<PreviewSnapshot[]>(['previews'], (previous = []) => previous.filter((item) => item.id !== id))
  }
  return { ...query, disconnect }
}
