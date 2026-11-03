import { assemblyCaptionSchema, type AssemblyCaption, type AssemblyVersion } from '@contracts/assembly'
import { timelineClips } from '../../../../shared/assembly-timing'

function promptSeconds(value: string): number {
  return value.split(':').reduce((time, part) => time * 60 + Number(part), 0)
}

export function captionsFromPrompts(version: AssemblyVersion, id: () => string): AssemblyCaption[] {
  const result: AssemblyCaption[] = []
  for (const { clip, start } of timelineClips(version)) {
    const lines: { text: string; start?: number; end?: number }[] = []
    let timing: { start: number; end: number } | undefined
    for (const line of clip.prompt.replace(/\r\n?/g, '\n').split('\n')) {
      // 时间范围沿用到下一时间块；引号本身不足以证明内容是对白。
      const range = /((?:\d{1,2}:){1,2}\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:-->|[-–—~～至])\s*((?:\d{1,2}:){1,2}\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:秒|s)?/i.exec(line)
      if (range) timing = { start: promptSeconds(range[1]!), end: promptSeconds(range[2]!) }
      const tagged = [...line.matchAll(/<d>([\s\S]*?)<\/d>/gi)].map((match) => match[1]!.replace(/^\s*\[[^\]]+\]\s*/, '').trim())
      const spoken = tagged.length ? tagged : [...line.matchAll(/(?:对白|台词|旁白|说(?:道)?|喊(?:道)?|问(?:道)?|回答|says?|dialogue|voiceover)[^“「"\n]{0,30}[“「"]([^”」"\n]+)[”」"]/gi)].map((match) => match[1]!.trim())
      for (const text of spoken) if (text && text.length <= 2000) lines.push({ text, ...timing })
    }
    // 同一时间块内的多句对白按字数分配，而不是让它们全部重叠。
    const groups = new Map<string, typeof lines>()
    for (const line of lines) {
      const key = line.start === undefined ? 'estimated' : `${line.start}:${line.end}`
      const group = groups.get(key) ?? []
      group.push(line); groups.set(key, group)
    }
    for (const group of groups.values()) {
      const from = group[0]!.start ?? 0
      const to = group[0]!.end ?? clip.sourceDuration
      if (to <= from) continue
      const weight = group.reduce((sum, line) => sum + Array.from(line.text).length, 0)
      let cursor = from
      for (const line of group) {
        const end = cursor + (to - from) * Array.from(line.text).length / weight
        const visibleStart = Math.max(clip.inPoint, cursor)
        const visibleEnd = Math.min(clip.outPoint, end)
        if (visibleEnd > visibleStart) {
          const caption = assemblyCaptionSchema.parse({ id: id(), text: line.text, start: start + visibleStart - clip.inPoint, end: start + visibleEnd - clip.inPoint })
          if (!(version.captions ?? []).some((old) => old.text === caption.text && Math.abs(old.start - caption.start) < 0.01 && Math.abs(old.end - caption.end) < 0.01)) result.push(caption)
          if (result.length + (version.captions?.length ?? 0) > 10000) throw new Error('字幕总数不能超过 10000 条')
        }
        cursor = end
      }
    }
  }
  return result.sort((a, b) => a.start - b.start)
}

function parseTimestamp(value: string): number {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value.trim())
  if (!match) throw new Error('字幕时间格式应为 HH:MM:SS,mmm')
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}
export function parseSrt(text: string, id: () => string): AssemblyCaption[] {
  if (text.length > 5_000_000) throw new Error('字幕文件超过 5 MB')
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/)
  if (blocks.length > 10000) throw new Error('字幕不能超过 10000 条')
  return blocks.map((block, index) => {
    const lines = block.split('\n')
    if (/^\d+$/.test(lines[0]?.trim() ?? '')) lines.shift()
    const timing = lines.shift()?.split(/\s+-->\s+/)
    if (timing?.length !== 2) throw new Error(`第 ${index + 1} 条字幕时间格式不正确`)
    const parsed = assemblyCaptionSchema.safeParse({ id: id(), start: parseTimestamp(timing[0]!), end: parseTimestamp(timing[1]!), text: lines.join('\n') })
    if (!parsed.success) throw new Error(`第 ${index + 1} 条字幕内容或时间范围不正确`)
    return parsed.data
  })
}
function timestamp(time: number): string {
  const milliseconds = Math.round(time * 1000)
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`
}
export function serializeSrt(captions: AssemblyCaption[]): string {
  return [...captions].sort((a, b) => a.start - b.start).map((caption, index) =>
    `${index + 1}\n${timestamp(caption.start)} --> ${timestamp(caption.end)}\n${caption.text}`).join('\n\n') + '\n'
}
