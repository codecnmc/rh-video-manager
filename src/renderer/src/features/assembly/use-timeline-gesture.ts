import { useRef, useState, type PointerEvent } from 'react'
import type { AssemblyVersion } from '@contracts/assembly'
import { clearInvalidTransitions, snapTime, timelineClips } from './assembly-state'

type Gesture = { kind: 'clip' | 'sound' | 'caption'; id: string; edge: 'in' | 'out' | 'move'; x: number; base: AssemblyVersion; next: AssemblyVersion; targetTrack: string | undefined }

export function useTimelineGesture(version: AssemblyVersion, zoom: number, position: number, snapping: boolean,
  onChange: (version: AssemblyVersion) => void) {
  const gesture = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<AssemblyVersion | null>(null)
  function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind'], id: string, edge: Gesture['edge']) {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { kind, id, edge, x: event.clientX, base: version, next: version, targetTrack: undefined }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active) return
    const delta = (event.clientX - active.x) / zoom
    const { base, id, edge } = active
    const snap = (time: number) => snapTime(time, base, position, zoom, snapping && !event.altKey)
    let next = base
    if (active.kind === 'clip') {
      const entry = timelineClips(base).find((item) => item.clip.id === id)
      if (!entry) return
      const clip = entry.clip
      const previousEnd = timelineClips(base)[base.clips.findIndex((item) => item.id === id) - 1]?.end ?? 0
      const patch = edge === 'move' ? { gapBefore: Math.max(0, snap(entry.start + delta) - previousEnd), transition: undefined } : edge === 'in'
        ? { inPoint: Math.max(0, Math.min(clip.outPoint - 1 / (base.frameRate ?? 30), clip.inPoint + snap(entry.start + delta) - entry.start)) }
        : { outPoint: Math.min(clip.sourceDuration, Math.max(clip.inPoint + 1 / (base.frameRate ?? 30), clip.outPoint + snap(entry.end + delta) - entry.end)) }
      next = clearInvalidTransitions({ ...base, clips: base.clips.map((item) => item.id === id ? { ...item, ...patch } : item) })
    } else if (active.kind === 'sound') {
      const sound = base.sounds.find((item) => item.id === id)
      if (!sound) return
      const clipStart = sound.clipId ? timelineClips(base).find((item) => item.clip.id === sound.clipId)?.start ?? 0 : 0
      const absolute = sound.start + clipStart
      const sourceIn = sound.sourceIn ?? 0
      let patch = {}
      if (edge === 'move') {
        // 仍绑定片段的声音保持相对时间；解除关联由检查器显式操作。
        patch = { start: Math.min(86400, Math.max(0, snap(absolute + delta) - clipStart)) }
      } else if (edge === 'in') {
        const change = Math.max(-sourceIn, -sound.start, Math.min(sound.duration - 1 / (base.frameRate ?? 30), snap(absolute + delta) - absolute))
        patch = { start: sound.start + change, sourceIn: sourceIn + change, duration: sound.duration - change, fadeIn: 0, fadeOut: 0 }
      } else {
        const maximum = sound.sourceDuration === undefined ? 86400 : sound.sourceDuration - sourceIn
        patch = { duration: Math.max(1 / (base.frameRate ?? 30), Math.min(maximum, snap(absolute + sound.duration + delta) - absolute)), fadeIn: 0, fadeOut: 0 }
      }
      const targetTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-audio-track]')?.dataset.audioTrack
      // 跨轨直到松手才搬移 DOM，避免拖拽中的按钮卸载而丢失指针捕获。
      active.targetTrack = edge === 'move' && targetTrack !== undefined && !base.tracks?.find((track) => track.id === targetTrack)?.locked ? targetTrack : undefined
      next = { ...base, sounds: base.sounds.map((item) => item.id === id ? { ...item, ...patch } : item) }
    } else {
      const caption = base.captions?.find((item) => item.id === id)
      if (!caption) return
      const movedStart = Math.min(86400 - caption.end + caption.start, Math.max(0, snap(caption.start + delta)))
      const patch = edge === 'move' ? { start: movedStart, end: movedStart + caption.end - caption.start }
        : edge === 'in' ? { start: Math.max(0, Math.min(caption.end - 0.001, snap(caption.start + delta))) }
          : { end: Math.min(86400, Math.max(caption.start + 0.001, snap(caption.end + delta))) }
      next = { ...base, captions: base.captions?.map((item) => item.id === id ? { ...item, ...patch } : item) }
    }
    active.next = next; setDraft(next)
  }
  function end(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active) return
    gesture.current = null; setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (active.targetTrack !== undefined && active.kind === 'sound') {
      active.next = { ...active.next, sounds: active.next.sounds.map((sound) => {
        if (sound.id !== active.id) return sound
        const moved = { ...sound }
        if (active.targetTrack) moved.trackId = active.targetTrack
        else delete moved.trackId
        return moved
      }) }
    }
    // 一次拖拽只生成一个撤销步骤，取消拖拽不写入工程。
    if (event.type !== 'pointercancel' && version === active.base && JSON.stringify(active.base) !== JSON.stringify(active.next)) onChange(active.next)
  }
  return { version: draft ?? version, begin, move, end }
}
