import type { AssemblyCaptionStyle, AssemblySound, AssemblyVersion } from './contracts/assembly'
import { isOverlappingTransition } from './assembly-transitions'

export const defaultCaptionStyle: AssemblyCaptionStyle = { size: 4, bottom: 8, outline: 0.15, color: '#ffffff' }

export function timelineClips(version: AssemblyVersion) {
  let cursor = 0
  return version.clips.map((clip) => {
    // 叠化使用已选源区间重叠，不静默读取裁切外的画面或延长素材。
    const overlap = isOverlappingTransition(clip.transition?.kind) ? clip.transition!.duration : 0
    const start = cursor + (clip.gapBefore ?? 0) - overlap
    cursor = start + clip.outPoint - clip.inPoint
    return { clip, start, end: cursor }
  })
}

export function totalDuration(version: AssemblyVersion): number { return timelineClips(version).at(-1)?.end ?? 0 }
export function soundStart(version: AssemblyVersion, sound: AssemblySound): number {
  return sound.start + (sound.clipId ? timelineClips(version).find((item) => item.clip.id === sound.clipId)?.start ?? 0 : 0)
}
export function soundGain(version: AssemblyVersion, sound: AssemblySound): number {
  const tracks = version.tracks ?? []
  const track = tracks.find((item) => item.id === sound.trackId)
  if (track?.muted || tracks.some((item) => item.solo) && !track?.solo) return 0
  return sound.gain * (track?.gain ?? 1)
}
export function soundEnvelope(sound: AssemblySound, local: number): number {
  return Math.max(0, Math.min(1, sound.fadeIn ? local / sound.fadeIn : 1,
    sound.fadeOut ? (sound.duration - local) / sound.fadeOut : 1))
}
export function clipOpacity(version: AssemblyVersion, index: number, time: number): number {
  const entries = timelineClips(version)
  const entry = entries[index]
  if (!entry || time < entry.start || time >= entry.end) return 0
  const { clip, start, end } = entry
  const local = time - start
  const next = entries[index + 1]?.clip.transition
  let opacity = Math.min(1, clip.fadeIn ? local / clip.fadeIn : 1, clip.fadeOut ? (end - time) / clip.fadeOut : 1)
  if (clip.transition?.kind === 'dissolve') opacity = Math.min(opacity, local / clip.transition.duration)
  if (clip.transition?.kind === 'black' || clip.transition?.kind === 'white') opacity = Math.min(opacity, local / (clip.transition.duration / 2))
  if (next?.kind === 'black' || next?.kind === 'white') opacity = Math.min(opacity, (end - time) / (next.duration / 2))
  return Math.max(0, opacity)
}
