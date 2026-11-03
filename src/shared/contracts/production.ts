import { z } from 'zod'
import { extensionIdSchema, extensionSettingsSchema } from './extensions'

export const productionScopeSchema = z.strictObject({ projectId: z.string().uuid(), draftId: z.string().uuid() })
export const dialogueImportSchema = z.array(z.strictObject({
  character: z.string().trim().max(100).default(''), text: z.string().min(1).max(5000),
  delivery: z.string().max(1000).default(''), startMs: z.number().int().min(0).max(3600000).default(0)
})).min(1).max(200)
export const dialogueLineSchema = z.strictObject({
  id: z.string().uuid(), character: z.string().trim().max(100), text: z.string().max(5000),
  delivery: z.string().max(1000), speed: z.number().min(0.5).max(2),
  extensionId: z.union([extensionIdSchema, z.literal('')]), providerId: z.string().max(128),
  voiceId: z.string().max(200), language: z.string().min(1).max(40),
  startMs: z.number().int().min(0).max(3600000)
})
export const dialoguePlanSchema = productionScopeSchema.extend({
  revision: z.number().int().nonnegative(), enabled: z.boolean(), lines: z.array(dialogueLineSchema).max(200)
}).superRefine((value, context) => {
  if (new Set(value.lines.map((line) => line.id)).size !== value.lines.length) context.addIssue({ code: 'custom', message: '台词 ID 重复' })
})
export const generateDialogueSchema = productionScopeSchema.extend({
  revision: z.number().int().positive(), lineId: z.string().uuid()
})
export const characterVoiceSchema = dialogueLineSchema.pick({ character: true, extensionId: true, providerId: true, voiceId: true, language: true, speed: true })
  .refine((value) => Boolean(value.character.trim() && value.extensionId && value.providerId && value.voiceId), '角色、引擎和音色不能为空')
export const projectVoicesSchema = z.strictObject({ projectId: z.string().uuid(), revision: z.number().int().nonnegative(), bindings: z.array(characterVoiceSchema).max(200) })
export const saveCharacterVoiceSchema = productionScopeSchema.extend({ revision: z.number().int().nonnegative(), binding: characterVoiceSchema })
export const productionTakeActionSchema = productionScopeSchema.extend({ takeId: z.string().uuid() })
export const adoptDialogueSchema = productionTakeActionSchema.extend({ revision: z.number().int().positive() })
export const dialogueTakeSchema = productionScopeSchema.extend({
  id: z.string().uuid(), planRevision: z.number().int().positive(),
  line: dialogueLineSchema, sourcePrompt: z.string().max(50000), providerVersion: z.string().max(40),
  configurationKey: z.string().max(240), providerSettings: extensionSettingsSchema,
  runtime: z.enum(['local', 'cloud']),
  status: z.enum(['queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  createdAt: z.string(), finishedAt: z.string().nullable(), error: z.string().nullable(),
  assetId: z.string().uuid().nullable(), durationMs: z.number().positive().nullable(), adopted: z.boolean()
})
export type ProductionScope = z.infer<typeof productionScopeSchema>
export type DialogueLine = z.infer<typeof dialogueLineSchema>
export type DialoguePlan = z.infer<typeof dialoguePlanSchema>
export type GenerateDialogue = z.infer<typeof generateDialogueSchema>
export type DialogueTake = z.infer<typeof dialogueTakeSchema>
export type ProductionTakeAction = z.infer<typeof productionTakeActionSchema>
export type AdoptDialogue = z.infer<typeof adoptDialogueSchema>
export type ProjectVoices = z.infer<typeof projectVoicesSchema>
export type SaveCharacterVoice = z.infer<typeof saveCharacterVoiceSchema>
export interface DialogueProduction { plan: DialoguePlan; takes: DialogueTake[]; voices: ProjectVoices }
