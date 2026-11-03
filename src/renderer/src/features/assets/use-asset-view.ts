import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePreferences } from '@/features/settings'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useAssetView() {
  const preferences = usePreferences()
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: async (assetLibraryView: 'details' | 'tiles') => unwrap(await desktop().saveAppPreferences({ assetLibraryView })),
    onSuccess: (saved) => { client.setQueryData(['app-preferences'], saved) }
  })
  return {
    view: preferences.data?.assetLibraryView ?? 'details',
    loading: preferences.isPending,
    disabled: !preferences.data || save.isPending,
    error: save.error?.message ?? preferences.error?.message,
    setView: (value: 'details' | 'tiles') => save.mutate(value)
  }
}
