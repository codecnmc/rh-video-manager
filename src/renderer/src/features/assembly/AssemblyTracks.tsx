import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faArrowUp, faArrowDown } from '@fortawesome/free-solid-svg-icons'
import type { AssemblyTrack, AssemblyVersion } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { soundKinds } from './assembly-state'

export function AssemblyTracks({ version, disabled, onChange }: { version: AssemblyVersion; disabled: boolean; onChange: (version: AssemblyVersion) => void }) {
  const tracks = version.tracks ?? []
  function update(id: string, patch: Partial<AssemblyTrack>) { onChange({ ...version, tracks: tracks.map((track) => track.id === id ? { ...track, ...patch } : track) }) }
  async function remove(track: AssemblyTrack) {
    if (track.locked) return
    const count = version.sounds.filter((sound) => sound.trackId === track.id).length
    if (count && !await confirmAction(`轨道“${track.name}”包含 ${count} 个声音。删除轨道后，声音保留在未分轨区域，是否继续？`)) return
    onChange({ ...version, tracks: tracks.filter((item) => item.id !== track.id), sounds: version.sounds.map((sound) => {
      if (sound.trackId !== track.id) return sound
      const next = { ...sound }; delete next.trackId; return next
    }) })
  }
  function move(index: number, offset: number) {
    const reordered = [...tracks]
    ;[reordered[index], reordered[index + offset]] = [reordered[index + offset]!, reordered[index]!]
    onChange({ ...version, tracks: reordered })
  }
  return <div><div className="assembly-pane-heading"><h3>音频轨道 · {tracks.length}</h3><Button variant="ghost" size="icon" title="新增音效轨" aria-label="新增音效轨" disabled={disabled || tracks.length >= 128} onClick={() => onChange({ ...version, tracks: [...tracks, {
    id: crypto.randomUUID(), name: `音效 ${tracks.length + 1}`, kind: 'effect', muted: false, solo: false, locked: false, gain: 1
  }] })}><FontAwesomeIcon icon={faPlus} /></Button></div>
    {tracks.map((track, index) => <section className="assembly-caption-item" key={track.id}><fieldset className="assembly-form" disabled={disabled}>
      <label>轨道名称<Input maxLength={80} value={track.name} disabled={track.locked} onChange={(event) => update(track.id, { name: event.target.value })} /></label>
      <label>用途<SelectField value={track.kind} disabled={track.locked} onChange={(event) => { const kind = event.target.value; if (kind in soundKinds) update(track.id, { kind: kind as AssemblyTrack['kind'] }) }}>{Object.entries(soundKinds).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</SelectField></label>
      <label>轨道音量 {Math.round(track.gain * 100)}%<input type="range" min={0} max={2} step={0.01} value={track.gain} disabled={track.locked} onChange={(event) => update(track.id, { gain: Number(event.target.value) })} /></label>
      <div className="assembly-track-toggles">{(['muted', 'solo', 'locked'] as const).map((key) => <label className="assembly-checkbox" key={key}><input type="checkbox" checked={track[key]} disabled={key !== 'locked' && track.locked} onChange={(event) => update(track.id, { [key]: event.target.checked })} />{{ muted: '静音', solo: '独听', locked: '锁定' }[key]}</label>)}</div>
      <div className="button-row"><Button variant="ghost" size="icon" title="轨道上移" aria-label="轨道上移" disabled={!index || track.locked} onClick={() => move(index, -1)}><FontAwesomeIcon icon={faArrowUp} /></Button>
        <Button variant="ghost" size="icon" title="轨道下移" aria-label="轨道下移" disabled={index === tracks.length - 1 || track.locked} onClick={() => move(index, 1)}><FontAwesomeIcon icon={faArrowDown} /></Button>
        <Button variant="ghost" size="icon" title="删除轨道并保留声音" aria-label="删除轨道" disabled={track.locked} onClick={() => void remove(track)}><FontAwesomeIcon icon={faTrash} /></Button></div>
    </fieldset></section>)}
  </div>
}
