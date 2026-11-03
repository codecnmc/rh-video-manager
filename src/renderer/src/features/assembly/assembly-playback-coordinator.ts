export class AssemblyPlaybackCoordinator {
  private players = new Map<object, () => void>()

  register(owner: object, pause: () => void): () => void {
    this.players.set(owner, pause)
    return () => { pause(); this.players.delete(owner) }
  }

  claim(owner: object): void {
    // 时间轴的多轨混音属于同一播放器；只暂停独立试听，不互斥混音内的音轨。
    for (const [other, pause] of this.players) if (other !== owner) pause()
  }

  pauseAll(): void { for (const pause of this.players.values()) pause() }
}
