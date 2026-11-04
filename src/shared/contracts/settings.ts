import { z } from 'zod'

export const editorModeSchema = z.enum(['edit', 'preview', 'split'])
export const appPreferencesSchema = z.strictObject({
  editorMode: editorModeSchema,
  editorFontSize: z.number().int().min(12).max(24),
  taskNotifications: z.boolean(),
  onboardingVersion: z.number().int().min(0).optional(),
  mcpAutoStart: z.boolean().optional(),
  assetLibraryView: z.enum(['details', 'tiles']).optional(),
  imageGenerationCardSize: z.number().int().min(220).max(400).multipleOf(20).optional(),
  lastProjectId: z.string().uuid().nullable().optional(),
  assemblySelections: z.record(z.string().regex(/^(public|[0-9a-f-]{36})$/i), z.string().uuid().nullable()).optional()
})
export const settingsDirectorySchema = z.enum(['data', 'logs', 'media'])
export type AppPreferences = z.infer<typeof appPreferencesSchema>
export type EditorMode = z.infer<typeof editorModeSchema>
export type SettingsDirectory = z.infer<typeof settingsDirectorySchema>
export interface MediaStorageStatus {
  directory: string
  pendingDirectory: string | null
  cleanupDirectory: string | null
  error: string
}
export interface AppInformation { version: string; dataDirectory: string; logsDirectory: string; availableBytes: number | null; mediaStorage?: MediaStorageStatus }
