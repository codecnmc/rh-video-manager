import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SaveLibraryDocument, DeleteLibraryDocument, AssignLibraryDocument } from '@contracts/script-library'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useScriptLibrary(projectId: string | null) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['script-library'] })
  const query = useQuery({ queryKey: ['script-library', projectId], queryFn: async () => unwrap(await desktop().listLibraryDocuments(projectId)), retry: false, refetchInterval: 2000 })
  const assign = useMutation({ mutationFn: async (input: AssignLibraryDocument) => unwrap(await desktop().assignLibraryDocument(input)), onSuccess: refresh })
  const save = useMutation({ mutationFn: async (input: SaveLibraryDocument) => unwrap(await desktop().saveLibraryDocument(input)), onSuccess: refresh })
  const remove = useMutation({ mutationFn: async (input: DeleteLibraryDocument) => unwrap(await desktop().deleteLibraryDocument(input)), onSuccess: refresh })
  return { ...query, save, remove, assign }
}
