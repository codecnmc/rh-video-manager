import { assemblyVersionSchema, type AssemblyClip, type AssemblyVersion, type TitleVisual } from './contracts/assembly'
import type { AssemblyEditOperation } from './contracts/assembly-edit'
import { insertTimelineClip } from './assembly-insert'
import { timelineClips } from './assembly-timing'

export function createTitleClip(visual: TitleVisual, duration: number, id: () => string): AssemblyClip {
  return { id: id(), assetId: null, title: visual.text.trim().slice(0, 30) || '文字卡', visual,
    inPoint: 0, outPoint: duration, sourceDuration: duration, originalAudio: false, prompt: '' }
}

// 对副本依次应用，最后统一校验；任一步失败不返回半成品，也不做持久化。
export function applyAssemblyEdits(version: AssemblyVersion, operations: AssemblyEditOperation[], id: () => string): AssemblyVersion {
  let next = structuredClone(version)
  const requireClip = (clipId: string) => {
    const clip = next.clips.find((item) => item.id === clipId)
    if (!clip) throw new Error('目标片段不存在')
    return clip
  }
  for (const operation of operations) {
    switch (operation.kind) {
      case 'set-transition': {
        const clip = requireClip(operation.clipId)
        if (operation.transition) clip.transition = operation.transition; else delete clip.transition
        break
      }
      case 'set-mask': {
        if (operation.clipId === null) {
          if (operation.mask) next.frameMask = operation.mask; else delete next.frameMask
        } else {
          const clip = requireClip(operation.clipId)
          if (operation.inherit) delete clip.frameMask; else clip.frameMask = operation.mask
        }
        break
      }
      case 'set-caption-style': next.captionStyle = operation.style; break
      case 'set-title': {
        const clip = requireClip(operation.clipId)
        if (!clip.visual) throw new Error('目标片段不是文字卡')
        clip.visual = operation.visual
        break
      }
      case 'insert-title': next = insertTimelineClip(next, createTitleClip(operation.visual, operation.duration, id), operation.position, id); break
      case 'replace-gap-with-title': {
        const clip = requireClip(operation.beforeClipId)
        const gap = clip.gapBefore ?? 0
        if (gap <= 0 || clip.transition) throw new Error('目标片段前没有可替换的独立黑场')
        const entry = timelineClips(next).find((item) => item.clip.id === clip.id)!
        const removed = new Set(operation.removeCaptionIds)
        for (const captionId of removed) {
          const caption = next.captions?.find((item) => item.id === captionId)
          if (!caption || caption.start < entry.start - gap - 0.000001 || caption.end > entry.start + 0.000001) throw new Error('只能移除该黑场内部的字幕')
        }
        const index = next.clips.findIndex((item) => item.id === clip.id)
        clip.gapBefore = 0
        next.clips.splice(index, 0, createTitleClip(operation.visual, gap, id))
        next.captions = (next.captions ?? []).filter((caption) => !removed.has(caption.id))
        break
      }
    }
  }
  return assemblyVersionSchema.parse(next)
}
