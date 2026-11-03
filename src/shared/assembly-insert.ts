import { assemblyVersionSchema, type AssemblyClip, type AssemblyVersion } from './contracts/assembly'
import { soundStart, timelineClips, totalDuration } from './assembly-timing'

type IdFactory = () => string

// 所有插入/移除使用同一时间拼接规则。跨接点声音分割并延续源入点，不拉伸或重放声音。
function spliceLayers(before: AssemblyVersion, after: AssemblyVersion, at: number, removed: number, added: number, id: IdFactory,
  continuation?: { from: string; to: string }): AssemblyVersion {
  const cutEnd = at + removed
  const shift = added - removed
  const entries = timelineClips(after)
  const parts = (start: number, end: number) => {
    if (end <= at) return [{ start, end, offset: 0 }]
    if (start >= cutEnd) return [{ start: start + shift, end: end + shift, offset: 0 }]
    return [
      ...(start < at ? [{ start, end: at, offset: 0 }] : []),
      ...(end > cutEnd ? [{ start: Math.max(start, cutEnd) + shift, end: end + shift, offset: Math.max(start, cutEnd) - start }] : [])
    ]
  }
  for (const sound of before.sounds) {
    if (soundStart(before, sound) + sound.duration > at && before.tracks?.some((track) => track.id === sound.trackId && track.locked)) {
      throw new Error('插入点之后有锁定音轨，请先解锁再联动调整')
    }
  }
  return assemblyVersionSchema.parse({ ...after,
    sounds: before.sounds.flatMap((sound) => {
      const start = soundStart(before, sound)
      if (start + sound.duration <= at) return [sound]
      return parts(start, start + sound.duration).map((part, index) => {
        const anchorId = continuation && sound.clipId === continuation.from && part.start >= at + added ? continuation.to : sound.clipId
        const anchor = entries.find((entry) => entry.clip.id === anchorId)
        const fadeIn = part.offset === 0 ? Math.min(sound.fadeIn ?? 0, part.end - part.start) : 0
        // 原关联失效或新段落位于锚点之前时，保留实际时间并解除关联。
        const clipId = anchor && part.start >= anchor.start ? anchor.clip.id : null
        return { ...sound, id: index === 0 ? sound.id : id(), clipId,
          start: part.start - (clipId ? anchor!.start : 0), duration: part.end - part.start,
          sourceIn: (sound.sourceIn ?? 0) + part.offset,
          fadeIn,
          fadeOut: part.offset + part.end - part.start >= sound.duration - 0.000001 ? Math.min(sound.fadeOut ?? 0, part.end - part.start - fadeIn) : 0 }
      })
    }),
    captions: (before.captions ?? []).flatMap((caption) => parts(caption.start, caption.end).map((part, index) => ({
      ...caption, id: index === 0 ? caption.id : id(), start: part.start, end: part.end
    })))
  })
}

export function insertTimelineClip(version: AssemblyVersion, clip: AssemblyClip, time: number, id: IdFactory): AssemblyVersion {
  if (clip.transition || clip.gapBefore) throw new Error('待插入片段不能自带前置空隙或转场')
  const entries = timelineClips(version)
  const at = Math.round(time * (version.frameRate ?? 30)) / (version.frameRate ?? 30)
  const duration = totalDuration(version)
  // 源文件边界可能不落在工程帧栅格上；已有接点保持精确，镜内位置才按帧对齐。
  const boundary = [0, duration, ...entries.flatMap((entry) => [entry.start, entry.end])].find((value) => Math.abs(time - value) < 0.000001)
  const point = boundary ?? at
  if (!Number.isFinite(point) || point < 0 || point > duration) throw new Error('插入点超出时间轴')
  const next = entries.find((entry) => point >= entry.start && point < entry.end)
  if (!next && point !== duration) throw new Error('请将播放头放在片段内或时间轴末尾')
  const overlapping = entries.filter((entry) => point >= entry.start && point < entry.end)
  if (overlapping.length > 1 || next?.clip.transition && point - next.start <= next.clip.transition.duration) throw new Error('转场区内不能插入画面，请先移开播放头或移除转场')
  const clips = [...version.clips]
  let continuation: { from: string; to: string } | undefined
  let insertion = clips.length
  if (next) {
    const index = clips.findIndex((item) => item.id === next.clip.id)
    if (point === next.start) {
      insertion = index
      clip = { ...clip, gapBefore: next.clip.gapBefore ?? 0 }
      clips[index] = { ...next.clip, gapBefore: 0 }
    } else {
      const offset = point - next.start
      const following = clips[index + 1]
      if (offset <= (next.clip.fadeIn ?? 0) || next.end - point <= Math.max(next.clip.fadeOut ?? 0, following?.transition?.duration ?? 0)) throw new Error('淡化区内不能分割插卡')
      const sourceTime = next.clip.inPoint + offset
      continuation = { from: next.clip.id, to: id() }
      clips.splice(index, 1, { ...next.clip, outPoint: sourceTime, fadeOut: 0 },
        { ...next.clip, id: continuation.to, inPoint: sourceTime, gapBefore: 0, fadeIn: 0, transition: undefined })
      insertion = index + 1
    }
  }
  clips.splice(insertion, 0, clip)
  return spliceLayers(version, { ...version, clips }, point, 0, clip.outPoint - clip.inPoint, id, continuation)
}

export function resizeGeneratedClip(version: AssemblyVersion, clipId: string, duration: number, id: IdFactory): AssemblyVersion {
  const entry = timelineClips(version).find((item) => item.clip.id === clipId)
  if (!entry?.clip.visual || !Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('字幕卡时长无效')
  if (entry.clip.transition || version.clips[version.clips.findIndex((clip) => clip.id === clipId) + 1]?.transition) throw new Error('请先移除字幕卡两侧转场再调整时长')
  const previous = entry.end - entry.start
  if (duration === previous) return version
  const clips = version.clips.map((clip) => clip.id === clipId ? { ...clip, inPoint: 0, outPoint: duration, sourceDuration: duration, fadeIn: 0, fadeOut: 0 } : clip)
  return spliceLayers(version, { ...version, clips }, entry.start + Math.min(previous, duration),
    Math.max(0, previous - duration), Math.max(0, duration - previous), id)
}

export function removeGeneratedClip(version: AssemblyVersion, clipId: string, id: IdFactory): AssemblyVersion {
  const entries = timelineClips(version)
  const index = entries.findIndex((entry) => entry.clip.id === clipId)
  const entry = entries[index]
  if (!entry?.clip.visual) return version
  const next = entries[index + 1]
  if (entry.clip.transition || next?.clip.transition) throw new Error('请先移除字幕卡两侧转场再波纹删除')
  const clips = version.clips.filter((clip) => clip.id !== clipId).map((clip) => clip.id === next?.clip.id
    ? { ...clip, gapBefore: (clip.gapBefore ?? 0) + (entry.clip.gapBefore ?? 0) } : clip)
  const at = next ? entry.start : entries[index - 1]?.end ?? 0
  return spliceLayers(version, { ...version, clips }, at, entry.end - at, 0, id)
}
