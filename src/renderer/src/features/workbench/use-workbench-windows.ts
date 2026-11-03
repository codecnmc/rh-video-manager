import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkbenchPresence } from '@contracts/workbench-windows'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { windowPeers } from './window-presence'

export function useWorkbenchWindows(presence: WorkbenchPresence, enabled: boolean) {
  const client = useQueryClient()
  const [reportError, setReportError] = useState('')
  const state = useQuery({ queryKey: ['workbench-windows'], queryFn: async () => unwrap(await desktop().workbenchWindowState()),
    retry: false, refetchInterval: 2000, refetchIntervalInBackground: true })
  useEffect(() => desktop().onWorkbenchWindowsChanged(() => {
    void client.invalidateQueries({ queryKey: ['workbench-windows'] })
  }), [client])
  const { projectId, view, draftId, boardId, dirty } = presence
  useEffect(() => {
    if (!enabled) return
    let active = true
    void desktop().reportWorkbenchPresence({ projectId, view, draftId, boardId, dirty }).then(unwrap).then(() => {
      if (active) setReportError('')
      void client.invalidateQueries({ queryKey: ['workbench-windows'] })
    }).catch((failure: unknown) => { if (active) setReportError(failure instanceof Error ? failure.message : '窗口状态上报失败') })
    return () => { active = false }
  }, [projectId, view, draftId, boardId, dirty, enabled, client])
  return { peers: state.data ? windowPeers(presence, state.data) : null, error: reportError || state.error?.message || '' }
}
