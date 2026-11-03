type TimelineAudio = Pick<HTMLAudioElement, 'readyState' | 'seeking' | 'paused' | 'ended' | 'currentTime' | 'duration' | 'playbackRate' | 'play' | 'pause'>

export class AssemblyAudioPlayback {
  private pending = false
  private generation = 0
  private epoch: string | number = -1
  private positioned = false
  private wanted = false
  private failed = false

  stop(element: TimelineAudio) {
    this.generation++
    this.wanted = false
    this.positioned = false
    element.playbackRate = 1
    element.pause()
  }

  sync(element: TimelineAudio, sourceTime: number, playing: boolean, epoch: string | number, _now: number, onError: (error: unknown) => void, buffering = false) {
    if (epoch !== this.epoch) {
      this.stop(element)
      this.epoch = epoch
      this.failed = false
    }
    this.wanted = playing && !buffering
    // 切镜缓冲只冻结当前位置，不定位音乐；定位代次只由主动 seek/循环改变。
    if (buffering) { element.pause(); return }
    if (!playing) element.pause()
    if (sourceTime < 0 || Number.isFinite(element.duration) && sourceTime >= element.duration) {
      this.stop(element)
      return
    }
    if (element.readyState < 1 || element.seeking) return
    // 主动跳转只定位一次；切镜缓冲暂停不能触发逐帧回拉和重复 play()。
    if (!this.positioned) {
      this.positioned = true
      if (Math.abs(element.currentTime - sourceTime) > 0.02) {
        element.currentTime = sourceTime
        if (!playing) element.pause()
        return
      }
    }
    if (!playing) { element.pause(); return }
    const ahead = element.currentTime - sourceTime
    if (ahead > 0.35) { element.pause(); return }
    // 连续播放只微调预览速率，不反复 seek；MP3 定位量化误差不能形成循环。
    // 该速率不写入工程或导出，音高由媒体元素的 preservesPitch 保持。
    element.playbackRate = ahead < -0.05 ? 1.02 : ahead > 0.05 ? 0.98 : 1
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
