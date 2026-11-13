import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCompress, faExpand, faPause, faPlay, faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'

function playbackTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function PreviewVideoPlayer({ source, sampling, label, onDuration, onError, onPlay }: {
  source: string | undefined; sampling: boolean; label: string; onDuration: (seconds: number) => void; onError: () => void; onPlay?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const player = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [notice, setNotice] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === player.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => { setPosition(0); setDuration(0); setPlaying(false); setNotice('') }, [source])
  useEffect(() => {
    if (!sampling || !source || !video.current) return
    // 有声自动播放可能被浏览器策略拒绝，保留手动播放入口并说明真实状态。
    let active = true
    void video.current.play().catch(() => { if (active) setNotice('有声自动播放未启动，请点击播放') })
    return () => { active = false }
  }, [source, sampling])
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === player.current) await document.exitFullscreen()
      else await player.current?.requestFullscreen()
      setNotice('')
    } catch { setNotice('无法进入全屏，请确认已加载更新后的应用') }
  }
  async function togglePlayback() {
    const element = video.current
    if (!element || !source) return
    if (!element.paused) { element.pause(); return }
    if (element.ended) element.currentTime = 0
    try { await element.play(); setNotice('') }
    catch { setNotice('暂时无法播放，请稍后重试') }
  }
  return <div ref={player} className="preview-player" aria-label={`${label}播放器`} onKeyDownCapture={(event) => {
    if (event.key === 'Escape' && document.fullscreenElement === player.current) {
      // 弹窗中的 Escape 先退出视频全屏，不能同时关闭素材预览。
      event.preventDefault(); event.stopPropagation(); void toggleFullscreen()
    }
  }}>
    <div className="preview-player-stage" onDoubleClick={() => void toggleFullscreen()}><video ref={video} src={source} autoPlay={sampling} muted={muted} loop={sampling} playsInline preload="metadata" aria-label={label}
      onLoadedMetadata={(event) => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds)) { setDuration(seconds); onDuration(seconds) } }}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onPlay={() => { setPlaying(true); onPlay?.() }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume) }} onError={onError} />
      {!playing && <Button variant="unstyled" className="preview-player-play" title="播放视频" aria-label="播放视频" disabled={!source} onClick={() => void togglePlayback()}><FontAwesomeIcon icon={faPlay} /></Button>}
    </div>
    <div className="preview-player-controls"><Button variant="ghost" size="icon" title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'} disabled={!source} onClick={() => void togglePlayback()}><FontAwesomeIcon icon={playing ? faPause : faPlay} /></Button>
      <input className="preview-player-seek" type="range" aria-label={`${label}播放进度`} min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!duration} onChange={(event) => { const time = event.target.valueAsNumber; if (video.current) { video.current.currentTime = time; setPosition(time) } }} />
      <span className="preview-player-time">{playbackTime(position)} / {playbackTime(duration)}</span>
      <Button variant="ghost" size="icon" title={muted || !volume ? '开启声音' : '静音'} aria-label={muted || !volume ? '开启声音' : '静音'} aria-pressed={muted || !volume} onClick={() => { const element = video.current; if (element) { const silent = element.muted || !element.volume; if (!element.volume) element.volume = 1; element.muted = !silent } }}><FontAwesomeIcon icon={muted || !volume ? faVolumeXmark : faVolumeHigh} /></Button>
      <Button variant="ghost" size="icon" title={fullscreen ? '退出全屏 (Esc)' : '全屏预览 · 双击画面'} aria-label={fullscreen ? '退出全屏' : '全屏预览'} aria-pressed={fullscreen} disabled={!source} onClick={() => void toggleFullscreen()}><FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} /></Button>
    </div>
    {notice && <p className="preview-player-notice" role="status">{notice}</p>}
  </div>
}
