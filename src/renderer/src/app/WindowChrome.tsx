import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMinus, faWindowMaximize, faWindowRestore, faXmark } from '@fortawesome/free-solid-svg-icons'
import alpacaIcon from '../../../../resources/alpaca.png'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function WindowChrome({ title = '羊驼AI影视' }: { title?: string }) {
  const [maximized, setMaximized] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!window.workbench) return
    void desktop().windowMaximized().then((result) => setMaximized(unwrap(result))).catch(() => undefined)
    return desktop().onWindowState(setMaximized)
  }, [])
  async function act(action: 'minimize' | 'maximize' | 'close') {
    try { setMaximized(unwrap(await desktop().windowAction(action))); setError('') }
    catch { setError('窗口操作失败') }
  }
  return <header className="window-chrome"><div className="window-drag-area" onDoubleClick={() => void act('maximize')}>
    <img src={alpacaIcon} width={20} height={20} alt="" /><strong>{title}</strong>{error && <span className="window-title-detail">{error}</span>}</div>
    <div className="window-controls"><Button variant="unstyled" title="最小化" aria-label="最小化" onClick={() => void act('minimize')}><FontAwesomeIcon icon={faMinus} /></Button>
      <Button variant="unstyled" title={maximized ? '还原窗口' : '最大化'} aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => void act('maximize')}><FontAwesomeIcon icon={maximized ? faWindowRestore : faWindowMaximize} /></Button>
      <Button variant="unstyled" className="window-close" title="关闭" aria-label="关闭" onClick={() => void act('close')}><FontAwesomeIcon icon={faXmark} /></Button></div>
  </header>
}
