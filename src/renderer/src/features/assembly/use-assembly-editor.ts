import { useEffect, useRef, useState } from 'react'
import type { AssemblyContent, AssemblyDocument, AssemblyVersion } from '@contracts/assembly'
import type { Asset } from '@contracts/assets'
import { currentVersion, clearInvalidTransitions } from './assembly-state'
import { probeVideo } from './use-assembly'

function contentOf(document: AssemblyDocument): AssemblyContent {
  return { title: document.title, episode: document.episode, versions: document.versions, activeVersionId: document.activeVersionId }
}

export function useAssemblyEditor(document: AssemblyDocument, onDirty: (dirty: boolean) => void,
  onSave: (content: AssemblyContent, revision: number) => Promise<AssemblyDocument>, onNotice: (message: string) => void) {
  const [content, setContent] = useState<AssemblyContent>(() => contentOf(document))
  const [baseline, setBaseline] = useState(() => JSON.stringify(contentOf(document)))
  const revision = useRef(document.revision)
  const [past, setPast] = useState<AssemblyContent[]>([])
  const [future, setFuture] = useState<AssemblyContent[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const readingVideo = useRef(false)
  const saving = useRef(false)
  const dirty = JSON.stringify(content) !== baseline
  const version = currentVersion(content)
  const clip = version.clips.find((item) => item.id === selected) ?? version.clips[0]
  useEffect(() => { onDirty(dirty || reading) }, [dirty, reading, onDirty])
  function change(next: AssemblyContent) {
    setPast((items) => [...items.slice(-49), content]); setFuture([]); setContent(next)
  }
  function updateVersion(next: AssemblyVersion) {
    change({ ...content, versions: content.versions.map((item) => item.id === next.id ? next : item) })
  }
  function undo() {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((items) => [content, ...items]); setContent(previous); setPast((items) => items.slice(0, -1))
  }
  function redo() {
    const next = future[0]
    if (!next) return
    setPast((items) => [...items, content]); setContent(next); setFuture((items) => items.slice(1))
  }
  async function save() {
    if (saving.current) return undefined
    if (!dirty) { onNotice('当前工程已是最新保存状态'); return document }
    saving.current = true
    try {
      const saved = await onSave(content, revision.current)
      revision.current = saved.revision
      setContent(contentOf(saved))
      setBaseline(JSON.stringify(contentOf(saved)))
      onNotice('排片工程已保存到本地 SQLite')
      return saved
    } catch (error) { onNotice(error instanceof Error ? error.message : '保存失败，修改仍保留在界面') }
    finally { saving.current = false }
  }
  async function addVideo(asset: Asset, start = 0, trackId?: string, beforeId?: string) {
    if (readingVideo.current) return
    // 点击与拖放可能在同一轮渲染内触发，使用同步锁避免重复读取和覆盖片段。
    readingVideo.current = true
    setReading(true)
    try {
      const duration = await probeVideo(asset.id, asset.kind === 'audio' ? 'audio' : 'video')
      const id = crypto.randomUUID()
      if (asset.kind === 'audio') {
        const existing = version.tracks?.find((track) => track.id === trackId && !track.locked) ?? version.tracks?.find((track) => track.kind === 'effect' && !track.locked)
        if (!existing && (version.tracks?.length ?? 0) >= 128) throw new Error('音轨数量已达 128 条，请先选择或解锁现有轨道')
        const track = existing ?? { id: crypto.randomUUID(), name: '音效', kind: 'effect' as const, muted: false, solo: false, locked: false, gain: 1 }
        updateVersion({ ...version, tracks: existing ? version.tracks ?? [] : [...(version.tracks ?? []), track], sounds: [...version.sounds, {
          id, clipId: null, trackId: track.id, kind: track.kind, title: asset.name, evidence: '', state: 'bound', assetId: asset.id,
          start, duration, sourceIn: 0, sourceDuration: duration, gain: 1
        }] })
        return
      }
      const clips = [...version.clips]
      const before = beforeId ? clips.findIndex((clip) => clip.id === beforeId) : -1
      clips.splice(before < 0 ? clips.length : before, 0, { id, assetId: asset.id, title: asset.name,
        sourceDuration: duration, inPoint: 0, outPoint: duration, prompt: asset.prompt, originalAudio: true })
      updateVersion(clearInvalidTransitions({ ...version, clips }))
      setSelected(id)
    } catch (error) { onNotice(error instanceof Error ? error.message : '视频添加失败') }
    finally { readingVideo.current = false; setReading(false) }
  }
  function move(direction: number) {
    if (!clip) return
    const index = version.clips.findIndex((item) => item.id === clip.id)
    const target = index + direction
    if (target < 0 || target >= version.clips.length) return
    const clips = [...version.clips]
    ;[clips[index], clips[target]] = [clips[target]!, clips[index]!]
    updateVersion(clearInvalidTransitions({ ...version, clips }))
  }
  return { content, change, version, updateVersion, clip, selected, setSelected, reading, dirty, save, addVideo, move,
    undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 }
}
