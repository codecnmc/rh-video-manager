type TimelineVideo = Pick<HTMLVideoElement, 'readyState' | 'seeking' | 'ended' | 'currentTime' | 'duration'>

export class AssemblyVideoPreparation {
  private positioned = new WeakSet<TimelineVideo>()

  reset() { this.positioned = new WeakSet() }

  prepare(element: TimelineVideo, sourceTime: number): boolean {
    if (element.readyState < 1 || element.seeking) return false
    if (this.positioned.has(element)) return true
    this.positioned.add(element)
    const target = Number.isFinite(element.duration) ? Math.min(sourceTime, element.duration) : sourceTime
    // 每次切入或主动跳转只定位一次；缓冲暂停不是重新定位的理由。
    if (Math.abs(element.currentTime - target) > 0.02) {
      element.currentTime = target
      return false
    }
    return true
  }
}

export function shouldHoldAssemblyVideo(currentTime: number, sourceTime: number): boolean {
  // 另一路解码尚未就绪时只暂停抢跑的视频，不向回 seek，避免叠化反复缓冲。
  return currentTime - sourceTime > 0.1
}

export function canAdvanceAssemblyVideo(element: Pick<HTMLVideoElement, 'readyState' | 'seeking'>): boolean {
  // 已有首帧即可推进；play() 的异步启动状态不是解码缺帧，不能据此暂停全部音轨。
  return element.readyState >= 2 && !element.seeking
}
