import { useCallback, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faPlus } from '@fortawesome/free-solid-svg-icons'
import type { AssemblySound, AssemblyVersion } from '@contracts/assembly'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { soundKinds, soundStates } from './assembly-state'
import { mediaSource } from './use-assembly'
import { soundStart, timelineClips } from '../../../../shared/assembly-timing'
import { useAssemblyPlaybackLease } from './AssemblyPlaybackScope'

export function AssemblySounds({ version, assets, selectedClip, selectedSound, onChange, disabled }: {
  version: AssemblyVersion; assets: Asset[]; selectedClip?: string | undefined; selectedSound?: string | null; onChange: (version: AssemblyVersion) => void; disabled: boolean
}) {
  function update(id: string, patch: Partial<AssemblySound>) {
    const sound = version.sounds.find((item) => item.id === id)
    if (version.tracks?.some((track) => track.id === sound?.trackId && track.locked)) return
    onChange({ ...version, sounds: version.sounds.map((sound) => sound.id === id ? { ...sound, ...patch } : sound) })
  }
  const selected = version.sounds.find((sound) => sound.id === selectedSound)
  const sounds = selected ? [selected] : version.sounds.filter((sound) => sound.clipId === null || sound.clipId === selectedClip)
  return <div className="assembly-sounds"><div className="assembly-pane-heading"><h3>声音需求</h3><Button variant="ghost" size="small" disabled={disabled} onClick={() => onChange({ ...version, sounds: [...version.sounds, {
    id: crypto.randomUUID(), clipId: selectedClip ?? null, kind: 'effect', title: '待补音效', state: 'missing', assetId: null, evidence: '', start: 0, duration: 1, gain: 1
  }] })}><FontAwesomeIcon icon={faPlus} />添加</Button></div>
    {!sounds.length && <div className="assembly-subtle-empty">暂无已标注声音需求</div>}
    {sounds.map((sound) => <article key={sound.id} className={`assembly-sound assembly-sound-${sound.state}`}>
      <div className="assembly-sound-title"><span className={sound.state === 'missing' || sound.state === 'review' ? 'text-warning' : 'muted'}>{soundStates[sound.state]}</span>
        <Button variant="ghost" size="icon" title="移除声音需求" aria-label={`移除声音需求：${sound.title}`} disabled={disabled || version.tracks?.some((track) => track.id === sound.trackId && track.locked)} onClick={() => onChange({ ...version, sounds: version.sounds.filter((item) => item.id !== sound.id) })}><FontAwesomeIcon icon={faTrash} /></Button></div>
      <fieldset disabled={disabled || version.tracks?.some((track) => track.id === sound.trackId && track.locked)} className="assembly-form">
        <label>名称<Input aria-label="声音需求名称" maxLength={200} value={sound.title} onChange={(event) => update(sound.id, { title: event.target.value })} /></label>
        <div className="assembly-field-pair"><label>类型<SelectField value={sound.kind} onChange={(event) => { const kind = event.target.value; if (kind in soundKinds) update(sound.id, { kind: kind as AssemblySound['kind'] }) }}>{Object.entries(soundKinds).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</SelectField></label>
          <label>状态<SelectField value={sound.state} onChange={(event) => { const state = event.target.value; if (state in soundStates) update(sound.id, { state: state as AssemblySound['state'], assetId: state === 'bound' ? sound.assetId : null }) }}>{Object.entries(soundStates).map(([value, label]) => <SelectOption key={value} value={value} disabled={value === 'bound' && !sound.assetId}>{label}</SelectOption>)}</SelectField></label></div>
        <label>轨道<SelectField value={sound.trackId ?? ''} onChange={(event) => {
          const next = { ...sound }; if (event.target.value) next.trackId = event.target.value; else delete next.trackId
          onChange({ ...version, sounds: version.sounds.map((item) => item.id === sound.id ? next : item) })
        }}><SelectOption value="">未分轨</SelectOption>{(version.tracks ?? []).map((track) => <SelectOption key={track.id} value={track.id} disabled={track.locked}>{track.name}</SelectOption>)}</SelectField></label>
        <label>时间跟随<SelectField value={sound.clipId ?? ''} onChange={(event) => {
          const clipId = event.target.value || null
          const start = soundStart(version, sound) - (clipId ? timelineClips(version).find((item) => item.clip.id === clipId)?.start ?? 0 : 0)
          update(sound.id, { clipId, start: Math.max(0, start) })
        }}><SelectOption value="">固定在成片时间</SelectOption>{version.clips.map((clip) => <SelectOption key={clip.id} value={clip.id}>跟随：{clip.title}</SelectOption>)}</SelectField></label>
        <label>音频素材<SelectField value={sound.assetId ?? ''} onChange={(event) => update(sound.id, { assetId: event.target.value || null, sourceKind: 'audio', sourceIn: 0, sourceDuration: undefined, state: event.target.value ? 'bound' : 'missing' })}><SelectOption value="">未绑定 · 待上传或选择</SelectOption>{assets.filter((asset) => asset.kind === 'audio' || asset.id === sound.assetId && sound.sourceKind === 'video').map((asset) => <SelectOption key={asset.id} value={asset.id}>{asset.name}</SelectOption>)}</SelectField></label>
        <div className="assembly-field-pair"><label>{sound.clipId ? '片段内起点 / 秒' : '整集起点 / 秒'}<Input type="number" min={0} step={0.1} value={sound.start} onChange={(event) => update(sound.id, { start: Number(event.target.value) })} /></label><label>时长 / 秒<Input type="number" min={0.01} step={0.1} value={sound.duration} onChange={(event) => update(sound.id, { duration: Number(event.target.value) })} /></label></div>
        <label>音源入点 / 秒<Input type="number" min={0} step={0.01} value={sound.sourceIn ?? 0} onChange={(event) => update(sound.id, { sourceIn: Number(event.target.value) })} /></label>
        <div className="assembly-field-pair"><label>淡入 / 秒<Input type="number" min={0} max={sound.duration} step={0.01} value={sound.fadeIn ?? 0} onChange={(event) => update(sound.id, { fadeIn: Number(event.target.value) })} /></label><label>淡出 / 秒<Input type="number" min={0} max={sound.duration} step={0.01} value={sound.fadeOut ?? 0} onChange={(event) => update(sound.id, { fadeOut: Number(event.target.value) })} /></label></div>
        <label>音量 {Math.round(sound.gain * 100)}%<input aria-label={`${sound.title}音量`} type="range" min={0} max={2} step={0.01} value={sound.gain} onChange={(event) => update(sound.id, { gain: Number(event.target.value) })} /></label>
        <label>音量 / %<Input aria-label={`${sound.title}音量百分比`} type="number" min={0} max={200} step={1} value={Math.round(sound.gain * 100)} onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) update(sound.id, { gain: Math.max(0, Math.min(200, value)) / 100 }) }} /></label>
        <label>提示词依据<textarea rows={2} maxLength={10000} value={sound.evidence} onChange={(event) => update(sound.id, { evidence: event.target.value })} /></label>
      </fieldset>
      {sound.assetId && <AssemblySoundAudition sound={sound} />}
    </article>)}
  </div>
}
function AssemblySoundAudition({ sound }: { sound: AssemblySound }) {
  const audio = useRef<HTMLAudioElement>(null)
  const claimPlayback = useAssemblyPlaybackLease(() => audio.current?.pause())
  const setAudio = useCallback((element: HTMLAudioElement | null) => {
    if (!element) audio.current?.pause()
    audio.current = element
  }, [])
  return <audio key={sound.assetId} ref={setAudio} controls preload="none" src={mediaSource(sound.assetId!)} onPlay={claimPlayback} aria-label={`试听：${sound.title}`} />
}
