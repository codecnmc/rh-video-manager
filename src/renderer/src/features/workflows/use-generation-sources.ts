import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { desktop, unwrap } from '@/shared/lib/desktop'
import type { ComfySource, RoutingSettings } from '@contracts/generation-sources'

export function useGenerationSources() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['generation-sources'], queryFn: async () => unwrap(await desktop().generationSources()) })
  const save = useMutation({ mutationFn: async (input: RoutingSettings) => unwrap(await desktop().saveGenerationSources(input)),
    onSuccess: (saved) => { client.setQueryData(['generation-sources'], saved); void client.invalidateQueries({ queryKey: ['workflows'] }) } })
  const test = useMutation({ mutationFn: async (source: Pick<ComfySource, 'address'>) => unwrap(await desktop().testComfySource({ address: source.address })) })
  const importWorkflow = async () => unwrap(await desktop().importComfyWorkflow())
  return { ...query, save: save.mutateAsync, test: test.mutateAsync, importWorkflow, pending: save.isPending || test.isPending }
}
