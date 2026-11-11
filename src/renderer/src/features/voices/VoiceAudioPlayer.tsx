import { useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'

const clock = (seconds: number) => Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '--:--'

export function VoiceAudioPlayer({ assetId, name }: { assetId: string; name: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  return <div className="voice-audio-player"><audio ref={audio} data-voice-audio preload="metadata" src={`workbench-asset://library/${assetId}`} onLoadedMetadata={() => setDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)}
    onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => { setPlaying(true); document.querySelectorAll<HTMLAudioElement>('audio[data-voice-audio]').forEach((other) => { if (other !== audio.current) other.pause() }) }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('音频暂时无法播放，请检查文件')} />
    <Button className="voice-play-button" variant="unstyled" aria-label={`${playing ? '暂停' : '试听'} ${name}`} onClick={async () => { const player = audio.current; if (!player) return; setError(''); if (playing) player.pause(); else try { await player.play() } catch { setError('音频暂时无法播放') } }}><FontAwesomeIcon icon={playing ? faPause : faPlay} /></Button>
    <div className="voice-play-track"><div><span>{playing ? '正在试听' : '试听音色'}</span><span>{clock(position)} / {duration ? clock(duration) : '--:--'}</span></div><input type="range" min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!duration} aria-label={`调整 ${name} 播放进度`} onChange={(event) => { if (audio.current) { audio.current.currentTime = event.target.valueAsNumber; setPosition(event.target.valueAsNumber) } }} /></div>
    {error && <p role="alert" className="field-error">{error}</p>}
  </div>
}
