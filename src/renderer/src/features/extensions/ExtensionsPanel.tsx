import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select-field'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { useCallback, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPuzzlePiece, faFolderOpen, faRotateRight, faTrash, faPlay, faVolumeHigh, faCircleNotch } from '@fortawesome/free-solid-svg-icons'
import type { InstalledExtension } from '@contracts/extensions'
import { Button } from '@/components/ui/button'
import { ExtensionSettings } from './ExtensionSettings'
import { useExtensions, useExtensionVoices } from './use-extensions'
import './extensions.css'

const statusLabels = { disabled: '已停用', idle: '待激活', activating: '激活中', active: '运行中', error: '异常' }
const permissionNames = { 'network.local': '本机模型服务', 'network.cloud': '云端联网', 'models.local': '本地模型文件', 'audio.reference': '参考录音', 'assets.selection': '所选素材文字快照' }

function SpeechProviderDetails({ extension, provider, locked, perform }: {
  extension: InstalledExtension; provider: InstalledExtension['manifest']['contributes']['speechProviders'][number]; locked: boolean
  perform: (action: () => Promise<unknown>) => Promise<void>
}) {
  const voices = useExtensionVoices(extension.id, provider.id)
  const capabilities = provider.capabilities
  return <div className="extension-provider"><div className="extension-provider-heading"><div><strong>{provider.name}</strong><span className="muted">{provider.runtime === 'local' ? '本地模型' : '云端 API'}</span></div>
    <Button variant="outline" disabled={locked || !extension.enabled || !extension.configured || voices.isFetching}
      title="激活插件并查询音色" onClick={() => void perform(() => voices.refetch({ throwOnError: true }))}><FontAwesomeIcon icon={faVolumeHigh} />查询音色</Button></div>
    <p className="muted">{[capabilities.presetVoices && '预置音色', capabilities.voiceCloning && '音色克隆', capabilities.emotion && '情绪控制'].filter(Boolean).join(' · ') || '语音合成'}</p>
    {voices.error && <p className="field-error">{voices.error.message}</p>}
    {voices.data && <div className="extension-voices"><Table><TableHeader><TableRow><TableHead>音色</TableHead><TableHead>音色 ID</TableHead><TableHead>语言</TableHead><TableHead>来源</TableHead></TableRow></TableHeader><TableBody>
      {voices.data.map((voice) => <TableRow key={voice.id}><TableCell>{voice.name}</TableCell><TableCell><code>{voice.id}</code></TableCell><TableCell>{voice.language}</TableCell><TableCell>{voice.source === 'preset' ? '预置' : '克隆'}</TableCell></TableRow>)}
    </TableBody></Table>{voices.data.length === 0 && <p className="muted">没有可用音色</p>}</div>}
  </div>
}

export function ExtensionsPanel({ onDirty, onNotice }: { onDirty: (value: boolean) => void; onNotice: (message: string) => void }) {
  const extensions = useExtensions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const installed = extensions.data ?? []
  const visible = installed.filter((item) => `${item.manifest.displayName} ${item.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (filter === 'all' || (filter === 'enabled' ? item.enabled : item.manifest.contributes.speechProviders.some((provider) => provider.runtime === filter))))
  const selected = installed.find((item) => item.id === selectedId) ?? visible[0]
  const changed = useCallback((value: boolean) => { setDirty(value); onDirty(value) }, [onDirty])
  async function allowChange() {
    if (busy) return false
    if (dirty && !(await confirmAction('放弃插件的未保存设置？'))) return false
    changed(false)
    return true
  }
  async function perform(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action() } catch (error) { onNotice(error instanceof Error ? error.message : '插件操作失败') }
    finally { setBusy(false); void extensions.refetch() }
  }
  return <section className="management-page extension-management"><div className="management-toolbar"><div><h2>已安装插件</h2><span className="muted">{installed.length} 个插件 · API 1.0.0</span></div>
    <div className="button-row"><Button variant="ghost" size="icon" title="刷新插件状态" aria-label="刷新插件状态" disabled={busy} onClick={() => void extensions.refetch()}><FontAwesomeIcon icon={faRotateRight} /></Button>
      <Button disabled={busy || dirty} onClick={() => void perform(extensions.install)}><FontAwesomeIcon icon={faFolderOpen} />安装本地插件</Button></div></div>
    {extensions.error && <p className="field-error" role="alert">{extensions.error.message}</p>}
    <div className="extension-filters"><Input aria-label="搜索插件" placeholder="搜索插件" value={search} disabled={busy || dirty} onChange={(event) => setSearch(event.target.value)} />
      <SelectField aria-label="筛选插件" value={filter} disabled={busy || dirty} onChange={(event) => setFilter(event.target.value)}><SelectOption value="all">全部插件</SelectOption><SelectOption value="enabled">已启用</SelectOption><SelectOption value="local">本地语音引擎</SelectOption><SelectOption value="cloud">云端语音引擎</SelectOption></SelectField></div>
    {extensions.isPending ? <div className="management-empty" role="status">正在读取插件</div> : installed.length === 0 ? <div className="management-empty"><FontAwesomeIcon icon={faPuzzlePiece} /><p>尚未安装插件</p></div>
      : <div className="extension-layout"><div className="extension-list" aria-label="插件列表">{visible.map((item) => <Button variant="unstyled" key={item.id} className={`extension-item ${item.id === selected?.id ? 'selected' : ''}`} disabled={busy}
        onClick={async () => { if (item.id !== selected?.id && await allowChange()) setSelectedId(item.id) }}><FontAwesomeIcon icon={faPuzzlePiece} /><span><strong>{item.manifest.displayName}</strong><small>{item.id} · {item.manifest.version}</small><small>{statusLabels[item.status]}{!item.configured ? ' · 未配置' : ''}</small></span></Button>)}
        {visible.length === 0 && <div className="management-empty">没有匹配的插件</div>}</div>
        {selected && <div className="extension-detail" key={selected.id}><header><div><h2>{selected.manifest.displayName}</h2><p className="muted">{selected.id} · {selected.manifest.version}</p></div>
          <div className="button-row"><label className="check-field"><CheckboxField  checked={selected.enabled} disabled={busy || dirty}
            onChange={(event) => void perform(() => extensions.enable(selected.id, event.target.checked))} />启用</label>
            <Button variant="ghost" size="icon" title="卸载插件" aria-label="卸载插件" disabled={busy || dirty} onClick={() => void perform(() => extensions.remove(selected.id))}><FontAwesomeIcon icon={faTrash} /></Button></div></header>
          <p>{selected.manifest.description}</p><dl className="extension-metadata"><dt>宿主状态</dt><dd>{statusLabels[selected.status]}{!selected.configured ? ' · 未配置' : ''}</dd>
            <dt>宿主 API</dt><dd>{selected.manifest.engines.videoWorkbench}</dd><dt>发布者</dt><dd>{selected.manifest.publisher} · 未验证签名</dd>
            <dt>声明用途</dt><dd>{selected.manifest.permissions.map((permission) => permissionNames[permission]).join('、') || '无'}</dd></dl>
          {selected.error && <p className="field-error" role="alert">{selected.error}</p>}
          {!!selected.manifest.contributes.pages?.length && <section className="extension-detail-section"><h3>侧边栏页面</h3>{selected.manifest.contributes.pages.map((page) => <p key={page.id}>{page.title}</p>)}</section>}
          {selected.manifest.contributes.speechProviders.length > 0 && <section className="extension-detail-section"><h3>语音引擎</h3>{[...selected.manifest.contributes.speechProviders].sort((a, b) => Number(a.runtime === 'cloud') - Number(b.runtime === 'cloud')).map((provider) =>
            <SpeechProviderDetails key={provider.id} extension={selected} provider={provider} locked={busy || dirty} perform={perform} />)}</section>}
          {selected.manifest.contributes.commands.length > 0 && <section className="extension-detail-section"><h3>命令</h3><div className="button-row">{selected.manifest.contributes.commands.map((command) =>
            command.contexts?.length ? <span className="muted" key={command.id}>{command.title} · {command.contexts.map((context) => context === 'script' ? '剧本' : '草稿').join(' / ')}</span> : <Button key={command.id} variant="outline" aria-busy={activeCommand === command.id} disabled={busy || dirty || !selected.enabled || !selected.configured} onClick={() => void perform(async () => {
              setActiveCommand(command.id)
              try { if (await extensions.command(selected.id, command.id)) onNotice('插件命令已完成') }
              finally { setActiveCommand(null) }
            })}><FontAwesomeIcon icon={activeCommand === command.id ? faCircleNotch : faPlay} spin={activeCommand === command.id} />{command.title}</Button>)}
            {activeCommand && <span className="muted" role="status">命令执行中</span>}</div></section>}
          <ExtensionSettings extension={selected} locked={busy} onDirty={changed} onSave={async (values, secrets) => {
            setBusy(true)
            try { await extensions.saveConfiguration(selected.id, values, secrets); onNotice('插件设置已保存，下次调用重新激活') }
            catch (error) { onNotice(error instanceof Error ? error.message : '插件设置未保存'); throw error }
            finally { setBusy(false) }
          }} onClearSecret={(key) => perform(() => extensions.clearSecret(selected.id, key))} />
        </div>}
      </div>}
  </section>
}
