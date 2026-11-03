import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowsRotate, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { ReleaseUpdate } from '@contracts/updates'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function ReleaseUpdates() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReleaseUpdate | null>(null)
  const [error, setError] = useState('')
  async function act(check: boolean) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (check) { setResult(null); setResult(unwrap(await desktop().checkReleaseUpdate())) }
      else unwrap(await desktop().openReleaseDownloads())
    } catch (failure) { setError(failure instanceof Error ? failure.message : '更新操作失败') }
    finally { setBusy(false) }
  }
  return <section className="settings-section"><h3>软件更新</h3>
    <div className="button-row">
      <Button variant="outline" disabled={busy} onClick={() => void act(true)}><FontAwesomeIcon icon={faArrowsRotate} />{busy ? '处理中' : '检查更新'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void act(false)}><FontAwesomeIcon icon={faArrowUpRightFromSquare} />发布页面</Button>
    </div>
    {result && <p role="status">{result.available ? `发现新版本 ${result.latestVersion}，可前往发布页面下载` : `当前版本 ${result.currentVersion}，未发现更高的正式版本`}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>
}
