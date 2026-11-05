import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowsRotate, faArrowUpRightFromSquare, faCircleCheck, faCircleExclamation, faCircleArrowUp } from '@fortawesome/free-solid-svg-icons'
import type { ReleaseUpdate } from '@contracts/updates'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function ReleaseUpdates() {
  const [action, setAction] = useState<'check' | 'open' | null>(null)
  const busy = action !== null
  const [result, setResult] = useState<ReleaseUpdate | null>(null)
  const [error, setError] = useState('')
  async function act(check: boolean) {
    if (busy) return
    setAction(check ? 'check' : 'open'); setError('')
    try {
      if (check) { setResult(null); setResult(unwrap(await desktop().checkReleaseUpdate())) }
      else unwrap(await desktop().openReleaseDownloads())
    } catch (failure) { setError(failure instanceof Error ? failure.message : '更新操作失败') }
    finally { setAction(null) }
  }
  const status = action === 'check' ? {
    tone: 'checking', icon: faArrowsRotate, title: '正在检查更新', detail: '正在获取最新正式版本信息…',
  } : error ? {
    tone: 'error', icon: faCircleExclamation, title: '更新操作未完成', detail: error,
  } : result ? {
    tone: result.available ? 'available' : 'latest',
    icon: result.available ? faCircleArrowUp : faCircleCheck,
    title: result.available ? `发现新版本 ${result.latestVersion}` : '已是最新版本',
    detail: result.available ? `当前版本 ${result.currentVersion} · 可前往发布页面下载` : `当前版本 ${result.currentVersion} · 暂无更高的正式版本`,
  } : null
  return <section className="settings-section"><h3>软件更新</h3>
    <div className="button-row">
      <Button variant="outline" disabled={busy} onClick={() => void act(true)}><FontAwesomeIcon icon={faArrowsRotate} spin={action === 'check'} />{action === 'check' ? '检查中' : '检查更新'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void act(false)}><FontAwesomeIcon icon={faArrowUpRightFromSquare} />发布页面</Button>
    </div>
    {status && <div className={`release-update-status is-${status.tone}`} role={error ? 'alert' : 'status'} aria-atomic="true">
      <FontAwesomeIcon className="release-update-status-icon" icon={status.icon} spin={action === 'check'} />
      <div className="release-update-status-copy"><strong>{status.title}</strong><p>{status.detail}</p></div>
    </div>}
  </section>
}
