import { Workbench } from '@/features/workbench'
import { WindowChrome } from './WindowChrome'
import { ConfirmationHost } from '@/components/ui/confirmation'
import { AssemblyWindow } from '@/features/assembly'
import { WindowCloseConfirmation } from './WindowCloseConfirmation'

export function App() {
  const detached = window.location.hash === '#assembly'
  return <div className="app-shell"><WindowChrome title={detached ? '羊驼AI影视 · 剪辑' : '羊驼AI影视'} />{detached ? <AssemblyWindow /> : <Workbench />}<ConfirmationHost /><WindowCloseConfirmation /></div>
}
