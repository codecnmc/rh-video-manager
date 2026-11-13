import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faDownload, faUpload, faFloppyDisk, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { appPreferencesSchema, type AppPreferences } from '@contracts/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { MarkdownModeControl } from '@/shared/components/MarkdownEditor'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { usePreferences } from './use-preferences'
import { useMediaStorage } from './use-media-storage'
import './settings.css'
import { DataMigration } from './DataMigration'
import { ReleaseUpdates } from './ReleaseUpdates'
import { DialogDebug } from './DialogDebug'

function PreferencesForm({ preferences, onDirty, onSaved }: { preferences: AppPreferences; onDirty: (dirty: boolean) => void; onSaved: (preferences: AppPreferences) => void }) {
  const form = useForm<AppPreferences>({ resolver: zodResolver(appPreferencesSchema), defaultValues: preferences })
  const [error, setError] = useState('')
  useEffect(() => { onDirty(form.formState.isDirty) }, [form.formState.isDirty, onDirty])
  return <form onSubmit={form.handleSubmit(async (input) => {
    setError('')
    try { const saved = unwrap(await desktop().saveAppPreferences({ editorMode: input.editorMode, editorFontSize: input.editorFontSize, taskNotifications: input.taskNotifications, mcpAutoStart: input.mcpAutoStart ?? true })); form.reset(saved); onSaved(saved) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '设置保存失败') }
  })}><fieldset disabled={form.formState.isSubmitting}><section className="settings-section"><h3>常规设置</h3>
    <h4>编辑器</h4>
    <div className="settings-row"><label>默认显示模式</label><MarkdownModeControl mode={form.watch('editorMode')} onChange={(value) => form.setValue('editorMode', value, { shouldDirty: true })} /></div>
    <div className="settings-row"><label htmlFor="editor-font-size">正文字号</label><Input id="editor-font-size" type="number" min={12} max={24} {...form.register('editorFontSize', { valueAsNumber: true })} /></div>
    <h4>通知与启动</h4>
    <div className="settings-row"><label htmlFor="task-notification">视频任务完成与失败通知</label><CheckboxField id="task-notification" checked={form.watch('taskNotifications')} onChange={(event) => form.setValue('taskNotifications', event.target.checked, { shouldDirty: true })} /></div>
    <div className="settings-row"><label htmlFor="mcp-auto-start">启动时自动开启已配置的 MCP</label><CheckboxField id="mcp-auto-start" checked={form.watch('mcpAutoStart') ?? true} onChange={(event) => form.setValue('mcpAutoStart', event.target.checked, { shouldDirty: true })} /></div>
    {(error || Object.keys(form.formState.errors).length > 0) && <p className="field-error" role="alert">{error || '字号应为 12 至 24 的整数'}</p>}
    <div className="button-row settings-form-actions"><Button variant="outline" disabled={!form.formState.isDirty} onClick={() => { form.reset(); setError('') }}><FontAwesomeIcon icon={faRotateLeft} />还原</Button>
      <Button type="submit" disabled={!form.formState.isDirty}><FontAwesomeIcon icon={faFloppyDisk} />保存设置</Button></div>
  </section></fieldset></form>
}

export function SettingsPanel({ onDirty, onNotice, onOpenGuide }: { onDirty: (dirty: boolean) => void; onNotice: (message: string) => void; onOpenGuide: () => void }) {
  const preferences = usePreferences()
  const information = useQuery({ queryKey: ['app-information'], queryFn: async () => unwrap(await desktop().appInformation()), retry: false })
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const storageAction = useMediaStorage(onNotice)
  const storage = information.data?.mediaStorage
  const storageBusy = busy || storageAction.isPending
  async function act(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败') }
    finally { setBusy(false) }
  }
  return <section className="management-page settings-page"><div className="settings-content"><div className="management-toolbar"><h2>设置</h2><span className="muted">{information.data ? `版本 ${information.data.version}` : ''}</span></div>
    {(preferences.error || information.error || error) && <p className="field-error" role="alert">{preferences.error?.message || information.error?.message || error}</p>}
    <div className="settings-columns"><div className="settings-column">
    <ReleaseUpdates />
    <section className="settings-section"><h3>使用帮助</h3><Button variant="outline" onClick={onOpenGuide}>重新打开首次使用引导</Button></section>
    {import.meta.env.DEV && <DialogDebug onNotice={onNotice} />}
    {preferences.data && <PreferencesForm preferences={preferences.data} onDirty={onDirty} onSaved={(saved) => { client.setQueryData(['app-preferences'], saved); onNotice('设置已保存') }} />}
    <section className="settings-section"><h3>剧本库备份</h3><div className="button-row"><Button variant="outline" disabled={busy} onClick={() => void act(async () => { if (unwrap(await desktop().exportLibraryBackup())) onNotice('剧本库文档已导出') })}><FontAwesomeIcon icon={faDownload} />导出文档备份</Button>
      <Button variant="outline" disabled={busy} onClick={() => void act(async () => { const count = unwrap(await desktop().importLibraryBackup()); if (count !== null) { await client.invalidateQueries({ queryKey: ['script-library'] }); onNotice(`已导入 ${count} 个文档副本`) } })}><FontAwesomeIcon icon={faUpload} />导入文档备份</Button></div>
    </section>
    </div><div className="settings-column">
    <section className="settings-section"><div className="settings-section-heading"><h3>本地存储</h3><Button variant="ghost" disabled={busy} onClick={() => void act(async () => { unwrap(await desktop().openSettingsDirectory('logs')) })}><FontAwesomeIcon icon={faFolderOpen} />运行日志</Button></div>
      <div className="settings-storage-row"><div className="settings-storage-info"><h4>素材存储位置</h4><p>{storage?.directory ?? '正在读取'}</p>
        <span className="muted">可用空间 {information.data?.availableBytes != null ? `${(information.data.availableBytes / 1024 ** 3).toFixed(1)} GiB` : '未读取'}</span></div>
        <div className="button-row"><Button variant="outline" disabled={storageBusy || !storage} onClick={() => void act(async () => { unwrap(await desktop().openSettingsDirectory('media')) })}><FontAwesomeIcon icon={faFolderOpen} />打开目录</Button>
          <Button variant="outline" disabled={storageBusy || !storage || !!storage.pendingDirectory || !!storage.cleanupDirectory} onClick={() => storageAction.mutate('choose')}><FontAwesomeIcon icon={faFolderOpen} />更改位置</Button></div>
      </div>
      <div className="settings-storage-row"><div className="settings-storage-info"><h4>数据目录</h4><p>{information.data?.dataDirectory ?? '正在读取'}</p></div>
        <Button variant="outline" disabled={busy} onClick={() => void act(async () => { unwrap(await desktop().openSettingsDirectory('data')) })}><FontAwesomeIcon icon={faFolderOpen} />打开目录</Button>
      </div>
      {(storage?.pendingDirectory || storage?.cleanupDirectory) && <dl>
      {storage?.pendingDirectory && <><dt>待迁移位置</dt><dd>{storage.pendingDirectory}</dd></>}
      {storage?.cleanupDirectory && <><dt>待清理旧副本</dt><dd>{storage.cleanupDirectory}</dd></>}
      </dl>}
      {(storage?.error || storageAction.error) && <p className="field-error" role="alert">{storageAction.error?.message || storage?.error}</p>}
      {storage?.pendingDirectory && <p className="muted settings-storage-notice">新位置已准备好，重启后开始复制并校验素材；完成后才切换目录。</p>}
      {(storage?.pendingDirectory || storage?.cleanupDirectory) && <div className="button-row settings-storage-actions">
        {(storage?.pendingDirectory || storage?.cleanupDirectory) && <Button disabled={storageBusy} onClick={() => storageAction.mutate('restart')}><FontAwesomeIcon icon={faRotateLeft} />{storage.pendingDirectory ? '重启并迁移' : '重启并重试清理'}</Button>}
        {storage?.pendingDirectory && <Button variant="outline" disabled={storageBusy} onClick={() => storageAction.mutate('cancel')}><FontAwesomeIcon icon={faRotateLeft} />取消更改</Button>}</div>}
    </section>
    <DataMigration onNotice={onNotice} />
    </div></div>
  </div></section>
}
