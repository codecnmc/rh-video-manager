import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faForwardStep, faPlay, faPause, faExpand, faClapperboard, faRotate, faClosedCaptioning } from '@fortawesome/free-solid-svg-icons'
import type { AssemblySound, AssemblyVersion } from '@contracts/assembly'
import { Button } from '@/components/ui/button'
import { mediaSource } from './use-assembly'
import { timecode } from './assembly-state'
import { AssemblyVideoPreparation, canAdvanceAssemblyVideo } from './assembly-video-playback'
import { clipColorSvgMatrix, clipColorTransform, hasClipColor } from '../../../../shared/clip-color'
import { clipOpacity, defaultCaptionStyle, soundEnvelope, soundGain, soundStart, timelineClips, totalDuration } from '../../../../shared/assembly-timing'
import { resolveAssemblyCanvas, titleFonts } from '../../../../shared/assembly-visual'
import { AssemblyGeneratedVisual } from './AssemblyGeneratedVisual'
import { AssemblyAudioPlayback } from './assembly-audio-playback'
import { useAssemblyPlaybackLease } from './AssemblyPlaybackScope'
import { isOverlappingTransition, transitionClipPath } from '../../../../shared/assembly-transitions'
import { AssemblyRaster } from './AssemblyRaster'
import { loadAssemblyFonts } from './assembly-fonts'

interface PlaybackProps {
  active?: boolean
  version: AssemblyVersion; seekRequest: { time: number; serial: number }
  onPosition: (position: number) => void; onNotice: (message: string) => void
}

function useAssemblyPlayback({ version, seekRequest, onPosition, onNotice, active: pageActive = true }: PlaybackProps) {
  const stage = useRef<HTMLDivElement>(null)
  const videos = useRef(new Map<number, HTMLVideoElement>())
  const starting = useRef(new WeakSet<HTMLVideoElement>())
  const preparation = useRef(new AssemblyVideoPreparation())
  const bufferingSince = useRef<number | null>(null)
  const playbackEpoch = useRef(0)
  const [audioEpoch, setAudioEpoch] = useState(0)
  const [playing, setPlaying] = useState(false)
  const requested = useRef(false)
  const [waiting, setWaiting] = useState(false)
  const [position, setPosition] = useState(0)
  const clock = useRef(0)
  const [volume, setVolume] = useState(0.8)
  const [originalColor, setOriginalColor] = useState(false)
  const [showCaptions, setShowCaptions] = useState(true)
  const [loop, setLoop] = useState(false)
  const [loopIn, setLoopIn] = useState(0)
  const [loopOut, setLoopOut] = useState(0)
  const [aspect, setAspect] = useState(16 / 9)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | undefined>()
  const [fontsReady, setFontsReady] = useState(false)
  const fonts = [...new Set([...version.clips.flatMap((clip) => clip.visual ? [clip.visual.font] : []), ...(version.captions?.length && version.captionStyle?.font ? [version.captionStyle.font] : [])])].sort()
  const fontsKey = fonts.join(',')
  useEffect(() => {
    let active = true
    setFontsReady(false)
    void loadAssemblyFonts(fonts, document.fonts).then(() => {
      if (!active) return
      setFontsReady(true)
    }).catch(() => { if (active) { stop(); onNotice('字幕卡本地字体载入失败，请检查应用字体资源') } })
    return () => { active = false }
  }, [fontsKey])
  const canvas = resolveAssemblyCanvas(version, sourceSize)
  const firstAsset = version.clips.find((clip) => clip.assetId)?.assetId
  useEffect(() => {
    setSourceSize(undefined)
    if (version.canvas || !firstAsset) return
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => { if (video.videoWidth && video.videoHeight) setSourceSize({ width: video.videoWidth, height: video.videoHeight }) }
    video.src = mediaSource(firstAsset)
    return () => { video.onloadedmetadata = null; video.removeAttribute('src'); video.load() }
  }, [firstAsset, version.canvas])
  useEffect(() => { setAspect(canvas.width / canvas.height) }, [canvas.width, canvas.height])
  const [frame, setFrame] = useState({ width: 320, height: 180 })
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
  const [audioContextEpoch, setAudioContextEpoch] = useState(0)
  const context = useRef<AudioContext | null>(null)
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const entries = timelineClips(version)
  const duration = totalDuration(version)
  const fps = version.frameRate ?? 30
  // 叠化时保留前后镜和下一镜，最多三路；空隙由主时钟继续推进。
  const index = Math.max(0, entries.reduce((found, item, itemIndex) => item.start <= position ? itemIndex : found, -1))
  const entry = entries[index]
  const previous = entries[index - 1]
  const overlap = previous && previous.end > position && entry && position >= entry.start
  const indices = overlap ? [index - 1, index, index + 1] : [index, index + 1]
  const active = entries.filter((item) => position >= item.start && position < item.end)
  const style = version.captionStyle ?? defaultCaptionStyle
  const captions = (version.captions ?? []).filter((caption) => position >= caption.start && position < caption.end)
  const latest = useRef({ version, entries, duration, loop, loopIn, loopOut, onPosition, onNotice, fontsReady, pageActive })
  latest.current = { version, entries, duration, loop, loopIn, loopOut, onPosition, onNotice, fontsReady, pageActive }
  function publish(time: number) { clock.current = time; setPosition(time); onPosition(time) }
  function stop() { requested.current = false; playbackEpoch.current++; bufferingSince.current = null; setPlaying(false); setWaiting(false); videos.current.forEach((element) => element.pause()); publish(clock.current) }
  const claimPlayback = useAssemblyPlaybackLease(stop)
  function seek(time: number) {
    playbackEpoch.current++
    setAudioEpoch((value) => value + 1)
    preparation.current.reset()
    bufferingSince.current = null
    const next = Math.min(duration, Math.max(0, time))
    publish(next)
    videos.current.forEach((element, clipIndex) => {
      const item = entries[clipIndex]
      if (!item) return
      const sourceTime = item.clip.inPoint + Math.max(0, Math.min(next - item.start, item.end - item.start))
      preparation.current.seek(element, sourceTime)
    })
  }
  function stepFrame(delta: number) {
    stop()
    seek(Math.round(clock.current * fps + delta) / fps)
  }
  const layout = JSON.stringify(version.clips.map((clip) => [clip.id, clip.assetId, clip.inPoint, clip.outPoint, clip.gapBefore, clip.transition]))
  const videoRefs = useMemo(() => version.clips.map((_, clipIndex) => (element: HTMLVideoElement | null) => {
    if (element) videos.current.set(clipIndex, element)
    else {
      videos.current.get(clipIndex)?.pause()
      videos.current.delete(clipIndex)
    }
  }), [layout])
  function preparationOnMetadata(element: HTMLVideoElement, clipIndex: number) {
    const item = latest.current.entries[clipIndex]
    if (!item) return
    const sourceTime = item.clip.inPoint + Math.max(0, Math.min(clock.current - item.start, item.end - item.start))
    if (requested.current) preparation.current.prepare(element, sourceTime)
    else preparation.current.seek(element, sourceTime)
  }
  useEffect(() => { stop(); preparation.current.reset(); publish(0) }, [version.id, layout])
  useEffect(() => { if (!pageActive) stop() }, [pageActive])
  useEffect(() => { seek(seekRequest.time) }, [seekRequest.serial])
  useEffect(() => () => { stop(); void context.current?.close().catch(() => {}) }, [])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const width = Math.min(element.clientWidth, element.clientHeight * aspect)
      setFrame({ width, height: width / aspect })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [aspect])
  useEffect(() => {
    // 暂停和隐藏页面不轮询媒体；入点准备由 seek、元数据事件和播放帧负责。
    if (!pageActive || !playing) return
    let previousTime = performance.now()
    let lastFrame = 0, lastEditorUpdate = 0
    let request = 0
    function tick(now: number) {
      const state = latest.current
      if (!state.pageActive || !requested.current) return
      // 预载不等于入点帧已准备：在切点之前完成下一镜定位，不能等它可见才 seek。
      for (const [clipIndex, element] of videos.current) {
        const item = state.entries[clipIndex]
        if (!item || clock.current >= item.start) continue
        element.muted = true
        if (!element.paused) element.pause()
        preparation.current.prepare(element, item.clip.inPoint)
      }
      const current = clock.current
      const visible = state.entries.filter((item) => current >= item.start && current < item.end)
      let buffered = true
      // 各路独立准备，不能让另一路未完成定位阻断本路的 play() 缓冲请求。
      for (const item of visible) {
        if (item.clip.visual) { if (!state.fontsReady) buffered = false; continue }
        const clipIndex = state.entries.indexOf(item)
        const element = videos.current.get(clipIndex)
        const sourceTime = item.clip.inPoint + current - item.start
        if (!element || !preparation.current.prepare(element, sourceTime)) { buffered = false; continue }
        // 自然片尾可能略早于保存的出点，不能再 seek 回去反复播放尾段。
        // 用户主动 seek 和循环定位由各自入口负责，不能在这里纠正 ended 元素。
        if (element.ended) continue
        // 常规漂移只微调速率；反复 pause/play 会把主线程调度误差放大成周期性卡顿。
        const drift = element.currentTime - sourceTime
        // 带原声的片段保持原速，避免保调变速损伤听感；静音画面仍可微调同步。
        element.playbackRate = item.clip.originalAudio ? 1 : drift > 0.05 ? 0.97 : drift < -0.05 ? 1.03 : 1
        // play() 允许浏览器继续填充缓冲；等待期间不能 pause() 中止这个请求。
        if (element.paused && !starting.current.has(element)) {
          starting.current.add(element)
          const epoch = playbackEpoch.current
          void element.play().then(() => {
            if (!requested.current || !element.isConnected || clock.current < item.start || clock.current >= item.end) element.pause()
          }).catch((error: unknown) => {
            if (error instanceof DOMException && error.name === 'AbortError') return
            if (requested.current && epoch === playbackEpoch.current && element.isConnected) { stop(); state.onNotice(`时间轴片段无法播放：${item.clip.title}`) }
          }).finally(() => starting.current.delete(element))
        }
        if (!canAdvanceAssemblyVideo(element)) buffered = false
      }
      if (requested.current) {
        setWaiting(!buffered)
        if (buffered) bufferingSince.current = null
        else {
          bufferingSince.current ??= now
          if (now - bufferingSince.current >= 12000) {
            stop()
            state.onNotice(`视频缓冲超时，已暂停在当前位置，请重试或检查素材：${visible.map((item) => item.clip.title).join('、')}`)
          }
        }
        if (buffered && requested.current) {
          const boundary = state.loop && state.loopOut > state.loopIn ? Math.min(state.duration, state.loopOut) : state.duration
          let next = current + (now - previousTime) / 1000
          // 时间轴只由统一时钟推进；媒体片尾时间精度不能阻止播放头跨过切点。
          // 精确落在下一边界，让新片段先定位/缓冲，避免一步跳过短片段或叠化入口。
          for (const item of state.entries) {
            if (item.start > current) next = Math.min(next, item.start)
            if (item.end > current) next = Math.min(next, item.end)
          }
          if (next >= boundary) {
            if (state.loop && state.loopOut > state.loopIn) {
              next = Math.max(0, state.loopIn)
              playbackEpoch.current++
              setAudioEpoch((value) => value + 1)
              preparation.current.reset()
              videos.current.forEach((element, clipIndex) => {
                element.pause()
                const item = state.entries[clipIndex]
                if (item) preparation.current.prepare(element, item.clip.inPoint + Math.max(0, Math.min(next - item.start, item.end - item.start)))
              })
            }
            else { next = state.duration; requested.current = false; setPlaying(false) }
          }
          clock.current = next
          const crossedBoundary = state.entries.some((item) => item.start > current && item.start <= next || item.end > current && item.end <= next)
          // 媒体时钟不依赖 React 渲染频率，切点立即刷新，普通预览最多 30Hz，编辑器最多 10Hz。
          if (crossedBoundary || now - lastFrame >= 1000 / 30 || !requested.current) { setPosition(next); lastFrame = now }
          if (crossedBoundary || now - lastEditorUpdate >= 100 || !requested.current) { state.onPosition(next); lastEditorUpdate = now }
        }
      }
      previousTime = now
      if (requested.current) request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [pageActive, playing])
  useEffect(() => {
    for (const [clipIndex, element] of videos.current) {
      const item = entries[clipIndex]
      if (!item || element.readyState < 1) continue
      const visible = position >= item.start && position < item.end
      const sourceTime = item.clip.inPoint + Math.max(0, Math.min(position - item.start, item.end - item.start))
      if (!requested.current) preparation.current.seek(element, sourceTime)
      let gain = 1
      if (isOverlappingTransition(item.clip.transition?.kind)) gain = Math.min(gain, Math.max(0, (position - item.start) / item.clip.transition!.duration))
      const next = entries[clipIndex + 1]
      if (isOverlappingTransition(next?.clip.transition?.kind)) gain = Math.min(gain, Math.max(0, (item.end - position) / next!.clip.transition!.duration))
      element.volume = volume * gain
      element.muted = !visible || !item.clip.originalAudio || !!version.tracks?.some((track) => track.solo)
      if (!visible || !playing) element.pause()
    }
  }, [position, playing, volume, layout, version.tracks])
  async function play() {
    if (!latest.current.pageActive) return
    const epoch = playbackEpoch.current
    // 播放前确认字体可用；CSS热更新后允许重试，失败时不进入永远等字体的缓冲状态。
    try {
      await loadAssemblyFonts(fonts, document.fonts)
      if (epoch !== playbackEpoch.current || !latest.current.pageActive) return
      setFontsReady(true)
    } catch {
      stop()
      onNotice('字幕卡本地字体载入失败，请检查应用字体资源后重试播放')
      return
    }
    try {
      claimPlayback()
      if (!context.current || context.current.state === 'closed') {
        context.current = new AudioContext()
        setAudioContext(context.current)
        // 热更新或音频引擎重建后，旧 MediaElementSource 不能接到另一个 AudioContext。
        setAudioContextEpoch((value) => value + 1)
      }
      await context.current.resume()
      if (epoch !== playbackEpoch.current || !latest.current.pageActive) return
      if (clock.current >= duration) seek(loop ? loopIn : 0)
      else seek(clock.current)
      requested.current = true; setPlaying(true)
    } catch { onNotice('无法启动时间轴音频预览') }
  }
  return { stage, videoRefs, preparationOnMetadata, playing, waiting, position, volume, setVolume, originalColor, setOriginalColor, showCaptions, setShowCaptions,
    loop, setLoop, loopIn, setLoopIn, loopOut, setLoopOut, frame, audioContext, prefix, entries, duration, fps, index, indices,
    active, style, captions, stop, seek, play, stepFrame, canvas, audioEpoch, audioContextEpoch }
}

export function AssemblyTimelinePlayer(props: PlaybackProps) {
  const { version, onNotice } = props
  const { stage, videoRefs, preparationOnMetadata, playing, waiting, position, volume, setVolume, originalColor, setOriginalColor, showCaptions, setShowCaptions,
    loop, setLoop, loopIn, setLoopIn, loopOut, setLoopOut, frame, audioContext, prefix, entries, duration, fps, index, indices,
    active, style, captions, stop, seek, play, stepFrame, canvas, audioEpoch, audioContextEpoch } = useAssemblyPlayback(props)
  const whiteTransition = entries.some((item, clipIndex) => item.clip.transition?.kind === 'white' && position >= item.start && position < item.start + item.clip.transition.duration / 2 ||
    entries[clipIndex + 1]?.clip.transition?.kind === 'white' && position < item.end && position >= item.end - entries[clipIndex + 1]!.clip.transition!.duration / 2)
  return <section className="assembly-preview">
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><defs>{version.clips.filter((clip) => clip.color && hasClipColor(clip.color)).map((clip) => {
      const color = clip.color!
      const { offset } = clipColorTransform(color)
      return <filter key={clip.id} id={`${prefix}-${clip.id}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={clipColorSvgMatrix(color)} /><feComponentTransfer><feFuncR type="linear" slope="1" intercept={offset} /><feFuncG type="linear" slope="1" intercept={offset} /><feFuncB type="linear" slope="1" intercept={offset} /></feComponentTransfer></filter>
    })}</defs></svg>
    <div className="assembly-pane-heading"><h2>时间轴预览</h2><span className="muted">{waiting && playing ? '正在缓冲' : `${version.clips.length} 个片段 · ${timecode(duration)}`}</span></div>
    <div className="assembly-preview-stage" ref={stage}><div className="assembly-output-frame" style={{ width: frame.width, height: frame.height, background: whiteTransition ? '#ffffff' : '#000000' }}>
      {indices.map((clipIndex) => {
        const item = entries[clipIndex]
        if (!item) return null
        const visible = position >= item.start && position < item.end
        const frameMask = item.clip.frameMask === undefined ? version.frameMask : item.clip.frameMask
        const following = entries[clipIndex + 1]
        const irisClosing = following && following.clip.transition?.kind === 'iris-close' && position >= following.start && position < item.end ? following : undefined
        const clipPath = irisClosing ? transitionClipPath('iris-close', (position - irisClosing.start) / irisClosing.clip.transition!.duration, true)
          : item.clip.transition ? transitionClipPath(item.clip.transition.kind, (position - item.start) / item.clip.transition.duration) : undefined
        return <div key={item.clip.id} className="assembly-video-layer" style={{ visibility: visible ? 'visible' : 'hidden', zIndex: irisClosing ? 2 : clipIndex === index ? 1 : 0, opacity: clipOpacity(version, clipIndex, position), clipPath }}>
          {item.clip.visual ? <AssemblyGeneratedVisual visual={item.clip.visual} canvas={canvas} height={frame.height} opacity={1} layer={0} /> : item.clip.assetId && <video ref={videoRefs[clipIndex]} src={mediaSource(item.clip.assetId)} preload="auto" playsInline muted={!visible || !item.clip.originalAudio || !!version.tracks?.some((track) => track.solo)}
          style={{ objectFit: canvas.fit, filter: !originalColor && hasClipColor(item.clip.color) ? `url(#${prefix}-${item.clip.id})` : 'none', transform: item.clip.transform ? `translate(${-item.clip.transform.x * (item.clip.transform.scale - 1) * frame.width / 2}px, ${-item.clip.transform.y * (item.clip.transform.scale - 1) * frame.height / 2}px) scale(${item.clip.transform.scale})` : 'none' }}
          onLoadedMetadata={(event) => { preparationOnMetadata(event.currentTarget, clipIndex) }}
          // 连续拖动可能发生在上次 seek 尚未结束时；暂停时没有播放帧轮询，完成后需补定位到最新游标。
          onSeeked={(event) => { preparationOnMetadata(event.currentTarget, clipIndex) }}
          onLoadedData={(event) => { preparationOnMetadata(event.currentTarget, clipIndex) }}
          onError={() => { stop(); onNotice(`视频不可用或格式不受支持：${item.clip.title}`) }} />}
          {frameMask && <AssemblyRaster request={{ kind: 'mask', width: canvas.width, height: canvas.height, mask: frameMask }} />}
        </div>
      })}
      {showCaptions && captions.length > 0 && <div className="assembly-caption-overlay" style={{ bottom: style.alignment === 'center' ? undefined : `${style.bottom}%`, top: style.alignment === 'center' ? '50%' : undefined, transform: style.alignment === 'center' ? 'translateY(-50%)' : undefined, fontFamily: style.font ? titleFonts[style.font].family : undefined, fontSize: frame.height * style.size / 100, WebkitTextStrokeWidth: frame.height * style.outline / 100, color: style.color }}>{captions.map((caption) => <div key={caption.id}>{caption.text}</div>)}</div>}
      {!version.clips.length && <div className="assembly-preview-empty"><FontAwesomeIcon icon={faClapperboard} /><span>尚未添加视频片段</span></div>}
    </div></div>
    {version.sounds.filter((sound) => sound.state === 'bound' && sound.assetId).map((sound) => <TimelineAudio key={`${audioContextEpoch}-${version.id}-${sound.id}-${sound.assetId}`} sound={sound} start={soundStart(version, sound)} gain={soundGain(version, sound)} context={audioContext} position={position} playing={playing} buffering={waiting} epoch={audioEpoch} volume={volume} onNotice={onNotice} />)}
    <div className="assembly-transport"><Button data-assembly-command="backward" variant="ghost" size="icon" title="后退一帧 (←)" aria-label="后退一帧" disabled={!duration} onClick={() => stepFrame(-1)}><FontAwesomeIcon icon={faBackwardStep} /></Button>
      <Button data-assembly-command="play" size="icon" title={playing ? '暂停时间轴 (空格)' : '播放时间轴 (空格)'} aria-label={playing ? '暂停时间轴' : '播放时间轴'} disabled={!duration} onClick={() => { if (playing) stop(); else void play() }}><FontAwesomeIcon icon={playing ? faPause : faPlay} /></Button>
      <Button data-assembly-command="forward" variant="ghost" size="icon" title="前进一帧 (→)" aria-label="前进一帧" disabled={!duration} onClick={() => stepFrame(1)}><FontAwesomeIcon icon={faForwardStep} /></Button>
      <input className="assembly-seek" aria-label="时间轴播放位置" type="range" min={0} max={duration || 1} step={1 / fps} value={position} disabled={!duration} onChange={(event) => seek(Number(event.target.value))} />
      <span className="assembly-time">{timecode(position)} / {timecode(duration)}</span><input className="assembly-volume" type="range" aria-label="预览监听音量" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
      <Button variant="ghost" size="icon" title="字幕预览" aria-label="字幕预览" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}><FontAwesomeIcon icon={faClosedCaptioning} /></Button>
      <Button variant="ghost" size="icon" title="循环播放选区" aria-label="循环播放选区" aria-pressed={loop} disabled={loopOut <= loopIn} onClick={() => setLoop(!loop)}><FontAwesomeIcon icon={faRotate} /></Button>
      <Button variant="ghost" size="icon" title="全屏预览" aria-label="全屏预览" disabled={!duration} onClick={() => { void stage.current?.requestFullscreen().catch(() => onNotice('无法进入全屏')) }}><FontAwesomeIcon icon={faExpand} /></Button></div>
    <div className="assembly-preview-caption"><strong>{active.at(-1)?.clip.title ?? (version.clips.length ? '黑场' : '未选择片段')}</strong><label className="assembly-checkbox"><input type="checkbox" checked={originalColor} onChange={(event) => setOriginalColor(event.target.checked)} />原画对比</label>
      <div className="button-row"><Button variant="ghost" size="small" disabled={!duration} onClick={() => setLoopIn(position)}>入 {timecode(loopIn)}</Button><Button variant="ghost" size="small" disabled={!duration} onClick={() => setLoopOut(position)}>出 {timecode(loopOut)}</Button></div></div>
  </section>
}

function TimelineAudio({ sound, start, position, playing, buffering, epoch, volume, gain, context, onNotice }: {
  sound: AssemblySound; start: number; position: number; playing: boolean; buffering: boolean; epoch: number; volume: number; gain: number; context: AudioContext | null; onNotice: (message: string) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const gainNode = useRef<GainNode | null>(null)
  const source = useRef<MediaElementAudioSourceNode | null>(null)
  const reported = useRef(false)
  const playback = useRef(new AssemblyAudioPlayback())
  const [audioSource, setAudioSource] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const element = audio.current
    let objectUrl: string | undefined
    reported.current = false
    setAudioSource(undefined)
    // 使用本地 Blob 提供可随机定位的音频源，避免自定义协议的流式读取回到文件头。
    void fetch(mediaSource(sound.assetId!), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('声音读取失败')
      const blob = await response.blob()
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setAudioSource(objectUrl)
    }).catch(() => {
      if (!controller.signal.aborted && !reported.current) { reported.current = true; onNotice(`声音素材无法读取：${sound.title}`) }
    })
    return () => {
      controller.abort()
      if (element) { playback.current.stop(element); element.removeAttribute('src'); element.load() }
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sound.assetId])
  useEffect(() => {
    if (!context || !audio.current) return
    source.current ??= context.createMediaElementSource(audio.current)
    const node = context.createGain()
    source.current.connect(node); node.connect(context.destination); gainNode.current = node
    return () => { source.current?.disconnect(); node.disconnect(); gainNode.current = null }
  }, [context])
  const synchronize = useRef(() => {})
  synchronize.current = () => {
    const element = audio.current
    if (!element) return
    const local = position - start
    if (gainNode.current) gainNode.current.gain.value = gain * volume * soundEnvelope(sound, local)
    const sourceTime = (sound.sourceIn ?? 0) + local
    if (local < 0 || local >= sound.duration) { playback.current.stop(element); return }
    playback.current.sync(element, sourceTime, playing && gain > 0, `${epoch}:${start}:${sound.sourceIn ?? 0}:${sound.duration}`, performance.now(), () => {
      if (!reported.current) { reported.current = true; onNotice(`声音无法同步到时间轴，请检查素材后重试：${sound.title}`) }
    }, buffering)
  }
  useEffect(() => { synchronize.current() }, [position, start, playing, buffering, epoch, sound.sourceIn, sound.duration, sound.fadeIn, sound.fadeOut, gain, volume, context])
  useEffect(() => {
    const element = audio.current
    return () => { if (element) playback.current.stop(element) }
  }, [])
  return <audio ref={audio} src={audioSource} preload="auto" onLoadedMetadata={(event) => { event.currentTarget.preservesPitch = true; synchronize.current() }} onCanPlay={() => synchronize.current()} onSeeked={() => synchronize.current()} onError={() => { if (!reported.current) { reported.current = true; onNotice(`声音素材不可用：${sound.title}`) } }} />
}
