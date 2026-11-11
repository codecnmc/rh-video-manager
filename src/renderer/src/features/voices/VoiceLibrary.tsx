import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMicrophone, faPlus, faFolderOpen, faPen, faMagnifyingGlass, faTrash } from '@fortawesome/free-solid-svg-icons'
import { confirmAction } from '@/components/ui/confirmation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import type { PublicVoice } from '@contracts/voices'
import { VoiceAudioPlayer } from './VoiceAudioPlayer'
import { AssetPicker } from '@/features/assets'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { useVoices } from './use-voices'
import './voices.css'

export function VoiceLibrary({ projectId, onNotice }: { projectId: string | null; onNotice: (message: string) => void }) {
  const voices = useVoices()
  const [search, setSearch] = useState('')
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<PublicVoice | null>(null)
  async function act(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    try { await action() } catch (error) { onNotice(error instanceof Error ? error.message : '音色操作失败') } finally { setBusy(false) }
  }
  const items = (voices.data ?? []).filter((voice) => voice.name.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="management-page voice-library"><div className="management-toolbar"><div><h2>公共音色库</h2><span className="muted">所有项目共享 · 视频对话参考</span></div><div className="button-row">
    <Button variant="outline" disabled={busy} onClick={() => setPicker(true)}>从素材选择</Button>
    <Button disabled={busy} onClick={() => void act(voices.importAudio)}><FontAwesomeIcon icon={faPlus} />导入音频</Button>
  </div></div><div className="voice-library-tools"><div className="voice-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><Input aria-label="搜索公共音色" placeholder="搜索音色名称" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span className="muted">{items.length} 个音色</span></div>
    {voices.error && <p className="field-error" role="alert">{voices.error.message}</p>}
    <div className="voice-grid">{items.map((voice) => <article className="voice-card voice-library-card" key={voice.id}><header><span className="voice-card-icon"><FontAwesomeIcon icon={faMicrophone} /></span><div><h3 title={voice.name}>{voice.name}</h3><span className="muted">公共音色 · {voice.size >= 1048576 ? `${(voice.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(voice.size / 1024))} KB`}</span></div><Button variant="ghost" size="icon" title="重命名音色" aria-label={`重命名 ${voice.name}`} disabled={busy} onClick={() => setRenaming(voice)}><FontAwesomeIcon icon={faPen} /></Button></header>
      <VoiceAudioPlayer assetId={voice.assetId} name={voice.name} />
      <footer><Button variant="ghost" size="small" disabled={busy} title="从音色库移除" onClick={() => void act(async () => { if (!await confirmAction(`从公共音色库移除「${voice.name}」？移除后不再提供音色选择，底层音频和历史引用保留。`)) return; await voices.remove({ id: voice.id, expectedUpdatedAt: voice.updatedAt }); onNotice('已从音色库移除，原音频和历史引用保留') })}><FontAwesomeIcon icon={faTrash} />删除</Button><Button variant="ghost" size="small" disabled={busy} onClick={() => void act(async () => { unwrap(await desktop().revealAsset(voice.assetId)) })}><FontAwesomeIcon icon={faFolderOpen} />打开位置</Button></footer>
    </article>)}</div>{!voices.isPending && !items.length && <div className="voice-empty" role="status"><FontAwesomeIcon icon={faMicrophone} /><p>{search ? '没有匹配的音色' : '暂无公共音色'}</p><span className="muted">{search ? '试试其他名称' : '导入音频，或从已有素材创建公共音色。'}</span></div>}
    {renaming && <RenameVoiceDialog voice={renaming} onClose={() => setRenaming(null)} onSave={async (name) => { await voices.rename({ id: renaming.id, expectedUpdatedAt: renaming.updatedAt, name }); onNotice('音色名称已更新') }} />}
    {picker && <AssetPicker projectId={projectId} requiredKind="audio" onClose={() => setPicker(false)} onPick={async (asset) => {
      await voices.fromAsset({ assetId: asset.id, expectedUpdatedAt: asset.updatedAt, name: asset.name }); onNotice('已复制到公共音色库，所有项目均可使用')
    }} />}
  </section>
}

function RenameVoiceDialog({ voice, onSave, onClose }: { voice: PublicVoice; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(voice.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Dialog title="重命名音色" onClose={() => { if (!busy) onClose() }}><form className="voice-rename-form" onSubmit={async (event) => { event.preventDefault(); if (!name.trim()) return; setBusy(true); setError(''); try { await onSave(name.trim()); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : '重命名失败') } finally { setBusy(false) } }}><label htmlFor="voice-rename">音色名称</label><Input id="voice-rename" autoFocus required maxLength={150} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} />{error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? '保存中' : '保存名称'}</Button></div></form></Dialog>
}
