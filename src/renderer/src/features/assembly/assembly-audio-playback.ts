type TimelineAudio = Pick<HTMLAudioElement, 'readyState' | 'seeking' | 'paused' | 'ended' | 'currentTime' | 'duration' | 'playbackRate' | 'play' | 'pause'>

export class AssemblyAudioPlayback {
  private pending = false
  private generation = 0
  private epoch: string | number = -1
  private positioned = false
  private wanted = false
  private failed = false
  private seekTarget: { time: number; retries: number } | null = null
  private behindSince: number | null = null
  private lastCorrection = -Infinity

  stop(element: TimelineAudio) {
    this.generation++
    this.wanted = false
    this.positioned = false
    this.seekTarget = null
    this.behindSince = null
    this.lastCorrection = -Infinity
    element.playbackRate = 1
    element.pause()
  }

  sync(element: TimelineAudio, sourceTime: number, playing: boolean, epoch: string | number, now: number, onError: (error: unknown) => void, buffering = false) {
    if (epoch !== this.epoch) {
      this.stop(element)
      this.epoch = epoch
      this.failed = false
    }
    this.wanted = playing && !buffering
    // 切镜缓冲只冻结当前位置，不定位音乐；定位代次只由主动 seek/循环改变。
    if (buffering) { this.behindSince = null; element.pause(); return }
    if (!playing) element.pause()
    if (sourceTime < 0 || Number.isFinite(element.duration) && sourceTime >= element.duration) {
      this.stop(element)
      return
    }
    if (element.readyState < 1 || element.seeking) return
    if (this.failed) { element.pause(); return }
    // currentTime 赋值不等于定位成功；允许编码帧量化误差，失败只重试一次。
    if (this.seekTarget) {
      if (Math.abs(element.currentTime - this.seekTarget.time) > 0.15) {
        element.pause()
        if (this.seekTarget.retries++ === 0) element.currentTime = this.seekTarget.time
        else { this.failed = true; onError(new Error('音频未能定位到时间轴位置')) }
        return
      }
      this.seekTarget = null
    }
    // 主动跳转定位后等待媒体确认，不能让旧位置的声音继续播放。
    if (!this.positioned) {
      this.positioned = true
      if (Math.abs(element.currentTime - sourceTime) > 0.02) {
        element.pause()
        this.seekTarget = { time: sourceTime, retries: 0 }
        element.currentTime = sourceTime
        return
      }
    }
    if (!playing) { element.pause(); return }
    // 音频可能先于时间轴自然结束；对 ended 元素调用 play 会从头重播。
    // 主动跳转已由上方的新代次定位处理，常规同步不能重启片尾。
    if (element.ended) return
    const ahead = element.currentTime - sourceTime
    if (ahead > 0.35) { element.pause(); return }
    // 异步定位、解码和缓冲可能让音乐持续落后，不能永久放任偏差。
    // 仅持续落后半秒后校正，且两秒内不重复，避免逐帧 seek 产生断音。
    if (ahead < -0.35) {
      this.behindSince ??= now
      if (now - this.behindSince >= 500 && now - this.lastCorrection >= 2000) {
        element.pause()
        this.seekTarget = { time: sourceTime, retries: 0 }
        element.currentTime = sourceTime
        this.lastCorrection = now
        this.behindSince = null
        return
      }
    } else this.behindSince = null
    // 音乐保持原速，容忍小幅时钟误差；频繁保调变速会产生发颤和金属音。
    // 小幅误差不变速，不逐帧重启音频。
    element.playbackRate = 1
    if (!element.paused || this.pending || this.failed) return
    this.pending = true
    const generation = this.generation
    void element.play().then(() => {
      if (!this.wanted || generation !== this.generation) element.pause()
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return
      if (this.wanted && generation === this.generation) { this.failed = true; onError(error) }
    }).finally(() => { this.pending = false })
  }
}
