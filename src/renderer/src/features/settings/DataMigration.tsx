import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faUpload } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { migrationPasswordSchema } from '@contracts/migration'

export function DataMigration({ onNotice }: { onNotice: (message: string) => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function transfer(exporting: boolean) {
    if (busy) return
    if (!migrationPasswordSchema.safeParse({ password }).success) { setError('迁移密码须为 12–256 个字符'); return }
    if (exporting && password !== confirmation) { setError('两次输入的密码不一致'); return }
    setBusy(true); setError('')
    try {
      const done = unwrap(await (exporting ? desktop().exportWorkspaceMigration(password) : desktop().importWorkspaceMigration(password)))
      setPassword(''); setConfirmation('')
      if (done) onNotice(exporting ? '加密迁移包已导出，请单独保管迁移密码' : '数据已导入，正在重启')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '数据迁移失败') }
    finally { setBusy(false) }
  }
  return <section className="settings-section" aria-busy={busy}><h3>数据迁移</h3>
    <dl><dt>包含数据</dt><dd>账号 Key、工作流、项目、剧本、草稿、任务、受管素材及排片工程</dd><dt>导入限制</dt><dd>空工作台 · 相同数据库版本 · 导入后重启</dd></dl>
    <div className="settings-row"><label htmlFor="migration-password">迁移密码（12–256 字符）</label><Input id="migration-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></div>
    <div className="settings-row"><label htmlFor="migration-confirmation">导出密码确认</label><Input id="migration-confirmation" type="password" autoComplete="new-password" maxLength={256} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {busy && <p role="status">正在处理迁移包，请勿关闭应用</p>}
    <div className="button-row"><Button variant="outline" disabled={busy} onClick={() => void transfer(true)}><FontAwesomeIcon icon={faDownload} />导出加密迁移包</Button>
      <Button variant="outline" disabled={busy} onClick={() => void transfer(false)}><FontAwesomeIcon icon={faUpload} />导入迁移包</Button></div>
  </section>
}
