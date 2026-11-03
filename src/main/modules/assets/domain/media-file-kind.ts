import { assetMediaExtensions } from '../../../../shared/contracts/assets'
import type { ReferenceKind } from '../../../../shared/contracts/references'

export function mediaFileKind(filename: string): ReferenceKind {
  const name = filename.split(/[\\/]/).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (assetMediaExtensions[kind].includes(extension)) return kind
  }
  throw new Error('素材格式不受支持，请选择图片、MP4/MOV/WebM 视频或 MP3/WAV/M4A/OGG/FLAC 音频')
}
