import { z } from 'zod'
import { layoutTitle } from '../title-layout'
import { assemblyTransitionSchema, frameMaskSchema, titleSurfaceSchema } from './assembly-effects'
import { isOverlappingTransition } from '../assembly-transitions'
import { assemblyExportOptionsSchema } from './assembly-export'

export const assemblyWindowTargetSchema = z.object({ projectId: z.string().uuid().nullable(), id: z.string().uuid() })
export type AssemblyWindowTarget = z.infer<typeof assemblyWindowTargetSchema>
export interface AssemblyWindowState { context: AssemblyWindowTarget | null; locks: AssemblyWindowTarget[] }
export const assemblySelectionSchema = z.object({ projectId: z.string().uuid().nullable(), id: z.string().uuid().nullable() })

const seconds = z.number().finite().min(0).max(86400)
export const clipColorSchema = z.object({
  brightness: z.number().finite().min(-0.2).max(0.2),
  contrast: z.number().finite().min(0.5).max(1.5),
  saturation: z.number().finite().min(0).max(2),
  temperature: z.number().finite().min(-0.3).max(0.3),
  tint: z.number().finite().min(-0.3).max(0.3)
})
export type ClipColor = z.infer<typeof clipColorSchema>
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const titleVisualSchema = z.object({
  kind: z.literal('title'), text: z.string().max(2000),
  font: z.enum(['song', 'sans']), size: z.number().finite().min(2).max(15),
  foreground: hexColor, background: hexColor, subtitle: z.string().max(300).optional(), surface: titleSurfaceSchema.optional()
}).strict()
export type TitleVisual = z.infer<typeof titleVisualSchema>
// 生成型画面的扩展入口；新类型在此声明，再分别接入预览和导出适配器。
export const generatedVisualSchema = z.discriminatedUnion('kind', [titleVisualSchema])
export type GeneratedVisual = z.infer<typeof generatedVisualSchema>
export const assemblyCanvasSchema = z.object({
  width: z.number().int().min(128).max(4096).refine((value) => value % 2 === 0),
  height: z.number().int().min(128).max(4096).refine((value) => value % 2 === 0),
  fit: z.enum(['contain', 'cover'])
})
export type AssemblyCanvas = z.infer<typeof assemblyCanvasSchema>
export const assemblyClipSchema = z.object({
  id: z.string().uuid(), assetId: z.string().uuid().nullable(), title: z.string().trim().min(1).max(200),
  visual: generatedVisualSchema.optional(),
  frameMask: frameMaskSchema.nullable().optional(),
  sourceDuration: seconds.positive(), inPoint: seconds, outPoint: seconds,
  prompt: z.string().max(100000), originalAudio: z.boolean(), color: clipColorSchema.optional(),
  gapBefore: seconds.optional(), fadeIn: seconds.optional(), fadeOut: seconds.optional(),
  transform: z.object({ scale: z.number().finite().min(1).max(3), x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) }).optional(),
  transition: assemblyTransitionSchema.optional()
}).refine((clip) => clip.outPoint > clip.inPoint && clip.outPoint <= clip.sourceDuration, { message: '裁切范围超出原片' })
  .refine((clip) => clip.visual ? clip.assetId === null && !clip.originalAudio && !clip.color && !clip.transform : clip.assetId !== null,
    { message: '视频须绑定素材；生成型画面不能绑定媒体、原声或视频调色与取景' })
export const assemblySoundSchema = z.object({
  id: z.string().uuid(), clipId: z.string().uuid().nullable(),
  kind: z.enum(['effect', 'ambience', 'music', 'voice']), title: z.string().trim().min(1).max(200),
  evidence: z.string().max(10000), state: z.enum(['missing', 'review', 'bound', 'original', 'none']),
  assetId: z.string().uuid().nullable(), start: seconds, duration: seconds.positive(), gain: z.number().finite().min(0).max(2),
  trackId: z.string().uuid().optional(), sourceKind: z.enum(['audio', 'video']).optional(),
  sourceIn: seconds.optional(), sourceDuration: seconds.positive().optional(), fadeIn: seconds.optional(), fadeOut: seconds.optional()
}).refine((sound) => sound.state === 'bound' ? sound.assetId !== null : sound.assetId === null, { message: '声音状态与素材绑定不一致' })
  .refine((sound) => (sound.fadeIn ?? 0) + (sound.fadeOut ?? 0) <= sound.duration &&
    (sound.sourceDuration === undefined || (sound.sourceIn ?? 0) + sound.duration <= sound.sourceDuration + 0.000001), { message: '声音裁切或淡化范围超出素材' })
export const assemblyTrackSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80), kind: z.enum(['effect', 'ambience', 'music', 'voice']),
  muted: z.boolean(), solo: z.boolean(), locked: z.boolean(), gain: z.number().finite().min(0).max(2)
})
export const assemblyCaptionSchema = z.object({
  id: z.string().uuid(), start: seconds, end: seconds, text: z.string().trim().min(1).max(2000)
}).refine((caption) => caption.end > caption.start, { message: '字幕结束时间必须晚于开始时间' })
export const assemblyCaptionStyleSchema = z.object({
  size: z.number().finite().min(2).max(15), bottom: z.number().finite().min(5).max(50),
  outline: z.number().finite().min(0).max(0.5), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(['song', 'sans']).optional(), alignment: z.enum(['bottom', 'center']).optional()
})
export const assemblyVersionSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  clips: z.array(assemblyClipSchema).max(1000), sounds: z.array(assemblySoundSchema).max(3000),
  tracks: z.array(assemblyTrackSchema).max(128).optional(), captions: z.array(assemblyCaptionSchema).max(10000).optional(),
  captionStyle: assemblyCaptionStyleSchema.optional(), burnCaptions: z.boolean().optional(),
  frameRate: z.number().finite().min(1).max(60).optional(), canvas: assemblyCanvasSchema.optional(), frameMask: frameMaskSchema.optional()
}).superRefine((version, context) => {
  const ids = version.clips.map((clip) => clip.id)
  if (new Set(ids).size !== ids.length || new Set(version.sounds.map((sound) => sound.id)).size !== version.sounds.length) context.addIssue({ code: 'custom', message: '片段或声音标识重复' })
  if (version.sounds.some((sound) => sound.clipId && !ids.includes(sound.clipId))) context.addIssue({ code: 'custom', message: '声音关联的片段不存在' })
  const tracks = version.tracks ?? []
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length || new Set((version.captions ?? []).map((caption) => caption.id)).size !== (version.captions ?? []).length) context.addIssue({ code: 'custom', message: '轨道或字幕标识重复' })
  if (version.sounds.some((sound) => sound.trackId && !tracks.some((track) => track.id === sound.trackId))) context.addIssue({ code: 'custom', message: '声音关联的轨道不存在' })
  for (const [index, clip] of version.clips.entries()) {
    if (clip.visual && !layoutTitle(clip.visual, version.canvas ?? { width: 1280, height: 720 }).fits) {
      context.addIssue({ code: 'custom', path: ['clips', index, 'visual', 'text'], message: '字幕卡文字过多，请分成多张卡片' })
    }
    const duration = clip.outPoint - clip.inPoint
    const previous = version.clips[index - 1]
    const incoming = clip.transition?.duration ?? 0
    const nextClip = version.clips[index + 1]
    const next = nextClip?.transition?.duration ?? 0
    if ((clip.fadeIn ?? 0) + (clip.fadeOut ?? 0) > duration || incoming + next >= duration ||
      clip.transition && (!previous || (clip.gapBefore ?? 0) > 0 || incoming >= previous.outPoint - previous.inPoint) ||
      isOverlappingTransition(clip.transition?.kind) && (clip.fadeIn ?? 0) > 0 || isOverlappingTransition(nextClip?.transition?.kind) && (clip.fadeOut ?? 0) > 0) {
      context.addIssue({ code: 'custom', path: ['clips', index], message: '转场余量不足、存在空隙或淡化范围超出片段' })
    }
  }
})
export const assemblyContentSchema = z.object({
  title: z.string().trim().min(1).max(150), episode: z.number().int().min(1).max(999999).nullable(),
  versions: z.array(assemblyVersionSchema).min(1).max(100), activeVersionId: z.string().uuid()
}).superRefine((content, context) => {
  if (!content.versions.some((version) => version.id === content.activeVersionId) || new Set(content.versions.map((version) => version.id)).size !== content.versions.length) context.addIssue({ code: 'custom', message: '剪辑版本标识不正确' })
})
export const assemblyDocumentSchema = assemblyContentSchema.safeExtend({
  id: z.string().uuid(), projectId: z.string().uuid().nullable(), revision: z.number().int().positive(), updatedAt: z.string().datetime()
})
export const saveAssemblySchema = z.object({
  id: z.string().uuid().nullable(), projectId: z.string().uuid().nullable(), expectedRevision: z.number().int().min(0), content: assemblyContentSchema
})
export const assemblyScopeSchema = z.object({ projectId: z.string().uuid().nullable() })
export const exportAssemblySchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid().nullable(), expectedRevision: z.number().int().positive(),
  versionId: z.string().uuid(), requestId: z.string().uuid(), allowPendingSounds: z.boolean(), options: assemblyExportOptionsSchema.optional()
})
export type ExportAssembly = z.infer<typeof exportAssemblySchema>
export type AssemblyClip = z.infer<typeof assemblyClipSchema>
export type AssemblySound = z.infer<typeof assemblySoundSchema>
export type AssemblyTrack = z.infer<typeof assemblyTrackSchema>
export type AssemblyCaption = z.infer<typeof assemblyCaptionSchema>
export type AssemblyCaptionStyle = z.infer<typeof assemblyCaptionStyleSchema>
export type AssemblyVersion = z.infer<typeof assemblyVersionSchema>
export type AssemblyContent = z.infer<typeof assemblyContentSchema>
export type AssemblyDocument = z.infer<typeof assemblyDocumentSchema>
export type SaveAssembly = z.infer<typeof saveAssemblySchema>
