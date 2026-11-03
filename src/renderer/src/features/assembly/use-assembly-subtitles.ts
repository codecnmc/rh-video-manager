import { useEffect, useRef, useState } from 'react'
import type { AssemblyCaption, AssemblyVersion } from '@contracts/assembly'
import { captionsFromPrompts, parseSrt, serializeSrt } from './assembly-subtitles'

export function useAssemblySubtitles(version: AssemblyVersion, onChange: (version: AssemblyVersion) => void, onNotice: (message: string) => void) {
  const [reading, setReading] = useState(false)
  const [draft, setDraft] = useState<{ snapshot: AssemblyVersion; captions: AssemblyCaption[] } | null>(null)
  const latest = useRef({ version, onChange })
  latest.current = { version, onChange }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function importSrt(file: File) {
    if (file.size > 5_000_000) { onNotice('字幕文件超过 5 MB'); return }
    setReading(true)
    try {
      const imported = parseSrt(await file.text(), () => crypto.randomUUID())
      if (!mounted.current) return
      const current = latest.current
      if ((current.version.captions?.length ?? 0) + imported.length > 10000) throw new Error('字幕总数不能超过 10000 条')
      current.onChange({ ...current.version, captions: [...(current.version.captions ?? []), ...imported] })
      onNotice(`已追加 ${imported.length} 条字幕，原字幕未覆盖`)
    } catch (error) { onNotice(error instanceof Error ? error.message : '字幕读取失败') }
    finally { setReading(false) }
  }
  function exportSrt() {
    const url = URL.createObjectURL(new Blob(['\uFEFF', serializeSrt(version.captions ?? [])], { type: 'application/x-subrip;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `${version.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.srt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function previewPrompts() {
    try {
      const captions = captionsFromPrompts(version, () => crypto.randomUUID())
      if (!captions.length) { onNotice('未找到新的明确对白；请检查片段来源提示词，或手工添加字幕'); return }
      setDraft({ snapshot: version, captions })
    } catch (error) { onNotice(error instanceof Error ? error.message : '对白提取失败') }
  }
  function appendDraft() {
    if (!draft) return
    if (latest.current.version !== draft.snapshot) { setDraft(null); onNotice('时间轴或字幕已修改，请重新提取对白'); return }
    onChange({ ...version, captions: [...(version.captions ?? []), ...draft.captions] })
    onNotice(`已追加 ${draft.captions.length} 条对白字幕，原字幕未覆盖；请核对实际说话时间`)
    setDraft(null)
  }
  return { reading, importSrt, exportSrt, draft, previewPrompts, appendDraft, cancelDraft: () => setDraft(null) }
}
