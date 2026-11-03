import { z } from 'zod'
import { titleVisualSchema, assemblyCaptionStyleSchema } from '../../../../shared/contracts/assembly'
import { assemblyTransitionSchema, frameMaskSchema } from '../../../../shared/contracts/assembly-effects'
import { assemblyTransitions } from '../../../../shared/assembly-transitions'
import { defaultFilmMask, titlePresets } from '../../../../shared/assembly-surfaces'
import { titleFonts } from '../../../../shared/assembly-visual'

export function assemblyCapabilities() {
  return {
    protocolVersion: 2,
    transitions: Object.entries(assemblyTransitions).map(([kind, definition]) => ({ kind, label: definition.label,
      overlapsSelectedRanges: definition.overlap, purpose: definition.purpose, defaultDuration: 0.5 })),
    masks: { kinds: ['rounded', 'ellipse'], default: defaultFilmMask, scopes: ['version', 'clip'], clipNullDisables: true },
    titlePresets: Object.entries(titlePresets).map(([id, preset]) => ({ id, ...preset })),
    fonts: Object.entries(titleFonts).map(([id, font]) => ({ id, label: font.label, bundled: true })),
    schemas: { transition: z.toJSONSchema(assemblyTransitionSchema), frameMask: z.toJSONSchema(frameMaskSchema),
      title: z.toJSONSchema(titleVisualSchema), captionStyle: z.toJSONSchema(assemblyCaptionStyleSchema) },
    operations: { saveSnapshot: true, structuredEdit: true, inspectMedia: true, exportViaMcp: false, arbitraryCode: false },
    export: { adapter: 'ffmpeg', requiresConfiguredMediaEngine: true, filters: ['xfade', 'overlay', 'subtitles'], verifiedAtExport: true },
    compatibility: '先查询当前运行实例的能力；未提供此工具的旧实例不能保证支持新字段。内置适配器随应用升级，MCP 只编辑数据，不安装代码。'
  }
}
