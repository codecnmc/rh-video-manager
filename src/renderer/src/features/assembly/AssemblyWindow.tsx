import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AssemblyLibrary } from './AssemblyLibrary'
import { useAssemblyWindows } from './use-assembly-windows'

export function AssemblyWindow() {
  const state = useAssemblyWindows()
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const onDirty = useCallback((value: boolean) => setDirty(value), [])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  const target = state.data?.context
  return <main className="assembly-window">
    {target ? <AssemblyLibrary projectId={target.projectId} initialDocumentId={target.id} detached onDirty={onDirty} onNotice={setNotice} />
      : <div className="app-status"><p>{state.isPending ? '正在打开剪辑工程' : state.error?.message ?? '独立剪辑会话已失效，请关闭此窗口后重试'}</p>
        {state.isError && <Button onClick={() => void state.refetch()}>重新载入</Button>}</div>}
    {notice && <div className="assembly-window-notice" role="status">{notice}</div>}
  </main>
}
