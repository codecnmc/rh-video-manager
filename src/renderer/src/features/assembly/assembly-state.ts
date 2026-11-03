import type { AssemblyContent, AssemblyVersion, AssemblySound } from '@contracts/assembly'
import { timelineClips, totalDuration, soundStart } from '../../../../shared/assembly-timing'
import { isOverlappingTransition } from '../../../../shared/assembly-transitions'
export { timelineClips, totalDuration } from '../../../../shared/assembly-timing'

export function currentVersion(content: AssemblyContent): AssemblyVersion {
  return content.versions.find((version) => version.id === content.activeVersionId) ?? content.versions[0]!
}
export function pendingSounds(version: AssemblyVersion): number {
  return version.sounds.filter((sound) => sound.state === 'missing' || sound.state === 'review').length
}
export function reorderClips(version: AssemblyVersion, sourceId: string, targetId: string, after: boolean): AssemblyVersion {
  if (sourceId === targetId) return version
  const source = version.clips.find((clip) => clip.id === sourceId)
  if (!source || !version.clips.some((clip) => clip.id === targetId)) return version
  const clips = version.clips.filter((clip) => clip.id !== sourceId)
  const index = clips.findIndex((clip) => clip.id === targetId)
  clips.splice(index + (after ? 1 : 0), 0, source)
  // 声音保持 clipId 绑定，随片段重新计算起点；绝对时间的声音不擅自移动。
  return clearInvalidTransitions({ ...version, clips })
}
export function locateTimelinePosition(entries: ReturnType<typeof timelineClips>, time: number) {
  const duration = entries.at(-1)?.end ?? 0
  const position = Math.min(duration, Math.max(0, Number.isFinite(time) ? time : 0))
  const found = entries.findIndex((item) => position < item.end)
  const index = found < 0 ? Math.max(0, entries.length - 1) : found
  const item = entries[index]
  return { position, index, sourceTime: item ? Math.max(item.clip.inPoint, item.clip.inPoint + position - item.start) : 0 }
}

export function clearInvalidTransitions(version: AssemblyVersion): AssemblyVersion {
  const clips = [...version.clips]
  for (let index = 0; index < clips.length; index++) {
    let clip = clips[index]!
    const previous = clips[index - 1]
    const duration = clip.outPoint - clip.inPoint
    if (clip.transition && (!previous || (clip.gapBefore ?? 0) > 0 || clip.transition.duration >= duration ||
      clip.transition.duration + (previous.transition?.duration ?? 0) >= previous.outPoint - previous.inPoint)) { clip = { ...clip }; delete clip.transition }
    if (isOverlappingTransition(clip.transition?.kind)) {
      if (clip.fadeIn) clip = { ...clip, fadeIn: 0 }
      if (previous?.fadeOut) clips[index - 1] = { ...previous, fadeOut: 0 }
    }
    if ((clip.fadeIn ?? 0) + (clip.fadeOut ?? 0) > duration) clip = { ...clip, fadeIn: 0, fadeOut: 0 }
    clips[index] = clip
  }
  return { ...version, clips }
}

export function splitSound(version: AssemblyVersion, id: string, time: number, newId: string): AssemblyVersion {
  const sound = version.sounds.find((item) => item.id === id)
  if (!sound || version.tracks?.some((track) => track.id === sound.trackId && track.locked)) return version
  const offset = time - soundStart(version, sound)
  if (offset <= 0 || offset >= sound.duration || offset < (sound.fadeIn ?? 0) || sound.duration - offset < (sound.fadeOut ?? 0)) return version
  return { ...version, sounds: version.sounds.flatMap((item) => item.id === id ? [
    { ...item, duration: offset, fadeIn: Math.min(item.fadeIn ?? 0, offset), fadeOut: 0 },
    { ...item, id: newId, start: item.start + offset, sourceIn: (item.sourceIn ?? 0) + offset, duration: item.duration - offset, fadeIn: 0, fadeOut: Math.min(item.fadeOut ?? 0, item.duration - offset) }
  ] : [item]) }
}

export function splitClip(version: AssemblyVersion, id: string, time: number, newId: string): AssemblyVersion {
  const entry = timelineClips(version).find((item) => item.clip.id === id)
  if (!entry || time <= entry.start || time >= entry.end) return version
  const clipIndex = version.clips.findIndex((clip) => clip.id === id)
  if (time - entry.start <= Math.max(entry.clip.transition?.duration ?? 0, entry.clip.fadeIn ?? 0) ||
    entry.end - time <= Math.max(version.clips[clipIndex + 1]?.transition?.duration ?? 0, entry.clip.fadeOut ?? 0)) return version
  const cut = entry.clip.inPoint + time - entry.start
  const left = { ...entry.clip, outPoint: cut, fadeOut: 0 }
  const right = { ...entry.clip, id: newId, inPoint: cut, gapBefore: 0, fadeIn: 0 }
  delete right.transition
  const sounds: AssemblySound[] = version.sounds.flatMap((sound) => {
    if (sound.clipId !== id) return [sound]
    const offset = time - entry.start
    if (sound.start >= offset) return [{ ...sound, clipId: newId, start: sound.start - offset }]
    // 跨切点的音频保留为一段，避免重新触发声音事件。
    return [sound]
  })
  return clearInvalidTransitions({ ...version, clips: version.clips.flatMap((clip) => clip.id === id ? [left, right] : [clip]), sounds })
}

export function removeClip(version: AssemblyVersion, id: string, ripple: boolean): AssemblyVersion {
  const entries = timelineClips(version)
  const index = entries.findIndex((item) => item.clip.id === id)
  if (index < 0) return version
  const entry = entries[index]!
  const next = entries[index + 1]
  const previous = entries[index - 1]
  const clips = version.clips.filter((clip) => clip.id !== id).map((clip) => {
    if (clip.id !== next?.clip.id) return clip
    const updated = { ...clip, gapBefore: ripple ? (entry.clip.gapBefore ?? 0) + (clip.gapBefore ?? 0) : next.start - (previous?.end ?? 0) }
    delete updated.transition
    return updated
  })
  const removed = totalDuration(version) - totalDuration({ ...version, clips })
  return clearInvalidTransitions({ ...version, clips,
    // 删除画面不丢弃后配音频；解除关联后保留实际位置。
    sounds: version.sounds.map((sound) => {
      const absolute = soundStart(version, sound)
      if (sound.clipId === id) return { ...sound, clipId: null, start: absolute }
      return ripple && !sound.clipId && absolute >= entry.end ? { ...sound, start: Math.max(0, absolute - removed) } : sound
    }),
    captions: (version.captions ?? []).map((caption) => ripple && caption.start >= entry.end
      ? { ...caption, start: Math.max(0, caption.start - removed), end: Math.max(0.001, caption.end - removed) } : caption)
  })
}

export function snapTime(time: number, version: AssemblyVersion, position: number, zoom: number, enabled: boolean): number {
  const frameRate = version.frameRate ?? 30
  const rounded = Math.round(Math.max(0, time) * frameRate) / frameRate
  if (!enabled) return rounded
  const points = [0, position, ...timelineClips(version).flatMap((item) => [item.start, item.end]),
    ...version.sounds.flatMap((sound) => { const start = soundStart(version, sound); return [start, start + sound.duration] }),
    ...(version.captions ?? []).flatMap((caption) => [caption.start, caption.end])]
  return points.filter((point) => Math.abs(point - rounded) < 8 / zoom)
    .sort((a, b) => Math.abs(a - rounded) - Math.abs(b - rounded))[0] ?? rounded
}

export function rollingTrim(version: AssemblyVersion, id: string, delta: number): AssemblyVersion {
  const index = version.clips.findIndex((clip) => clip.id === id)
  const left = version.clips[index]
  const right = version.clips[index + 1]
  if (!left || !right || right.transition || (right.gapBefore ?? 0) > 0) return version
  const leftMinimum = (left.transition?.duration ?? 0) + 0.001
  const rightMinimum = (version.clips[index + 2]?.transition?.duration ?? 0) + 0.001
  const change = Math.max(Math.max(left.inPoint + leftMinimum - left.outPoint, -right.inPoint),
    Math.min(delta, left.sourceDuration - left.outPoint, right.outPoint - right.inPoint - rightMinimum))
  return clearInvalidTransitions({ ...version, clips: version.clips.map((clip) => clip.id === left.id
    ? { ...clip, outPoint: clip.outPoint + change } : clip.id === right.id ? { ...clip, inPoint: clip.inPoint + change } : clip) })
}
export function timecode(seconds: number): string {
  const value = Math.max(0, seconds)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(2).padStart(5, '0')}`
}
export const soundKinds = { effect: '音效', ambience: '环境声', music: '背景音乐', voice: '配音' } as const
export const soundStates = { missing: '待补素材', review: '待确认', bound: '已绑定', original: '原片已有', none: '明确不需要' } as const
