import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faExpand, faPause, faPlay, faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'

function playbackTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function PreviewVideoPlayer({ source, sampling, label, onDuration, onError }: {
  source: string | undefined; sampling: boolean; label: string; onDuration: (seconds: number) => void; onError: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const player = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(sampling)
  const [volume, setVolume] = useState(1)
  const [notice, setNotice] = useState('')
  useEffect(() => { setPosition(0); setDuration(0); setPlaying(false); setNotice('') }, [source])
  async function togglePlayback() {
    const element = video.current
    if (!element || !source) return
    if (!element.paused) { element.pause(); return }
    if (element.ended) element.currentTime = 0
    try { await element.play(); setNotice('') }
    catch { setNotice('暂时无法播放，请稍后重试') }
  }
  return <div ref={player} className="preview-player" aria-label={`${label}播放器`}>
    <div className="preview-player-stage"><video ref={video} src={source} autoPlay={sampling} muted={muted} loop={sampling} playsInline preload="metadata" aria-label={label}
      onLoadedMetadata={(event) => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds)) { setDuration(seconds); onDuration(seconds) } }}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume) }} onError={onError} />
      {!playing && <Button variant="unstyled" className="preview-player-play" title="播放视频" aria-label="播放视频" disabled={!source} onClick={() => void togglePlayback()}><FontAwesomeIcon icon={faPlay} /></Button>}
    </div>
    <div className="preview-player-controls"><Button variant="ghost" size="icon" title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'} disabled={!source} onClick={() => void togglePlayback()}><FontAwesomeIcon icon={playing ? faPause : faPlay} /></Button>
      <input className="preview-player-seek" type="range" aria-label={`${label}播放进度`} min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!duration} onChange={(event) => { const time = event.target.valueAsNumber; if (video.current) { video.current.currentTime = time; setPosition(time) } }} />
      <span className="preview-player-time">{playbackTime(position)} / {playbackTime(duration)}</span>
      <Button variant="ghost" size="icon" title={muted || !volume ? '开启声音' : '静音'} aria-label={muted || !volume ? '开启声音' : '静音'} aria-pressed={muted || !volume} onClick={() => { const element = video.current; if (element) { const silent = element.muted || !element.volume; if (!element.volume) element.volume = 1; element.muted = !silent } }}><FontAwesomeIcon icon={muted || !volume ? faVolumeXmark : faVolumeHigh} /></Button>
      <Button variant="ghost" size="icon" title="全屏预览" aria-label="全屏预览" onClick={() => { void player.current?.requestFullscreen().catch(() => setNotice('暂时无法进入全屏')) }}><FontAwesomeIcon icon={faExpand} /></Button>
    </div>
    {notice && <p className="preview-player-notice" role="status">{notice}</p>}
  </div>
}
