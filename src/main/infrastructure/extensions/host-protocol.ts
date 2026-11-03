import { z } from 'zod'
import { extensionManifestSchema, extensionSettingsSchema, speechSynthesisRequestSchema, extensionDocumentContextSchema, extensionStorageOperationSchema, extensionPageContextSchema } from '../../../shared/contracts/extensions'

export const hostStorageRequestSchema = z.strictObject({ kind: z.literal('storage'), requestId: z.string().uuid(), input: extensionStorageOperationSchema })
export const hostStorageResponseSchema = z.strictObject({ kind: z.literal('storage-result'), requestId: z.string().uuid(), ok: z.boolean(), value: z.unknown().optional() })
export const hostOpenStorageRequestSchema = z.strictObject({ kind: z.literal('open-storage-directory'), requestId: z.string().uuid() })

export const hostRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('activate'),
    entry: z.string().min(1), storagePath: z.string().min(1), manifest: extensionManifestSchema, settings: extensionSettingsSchema,
    secrets: z.record(z.string(), z.string().max(4000)) }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('command'), id: z.string().max(128) }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('contextCommand'), id: z.string().max(128), context: extensionDocumentContextSchema }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('page'), id: z.string().max(128), context: extensionPageContextSchema }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('voices'), id: z.string().max(128) }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('synthesize'), id: z.string().max(128), input: speechSynthesisRequestSchema }),
  z.strictObject({ requestId: z.string().uuid(), method: z.literal('deactivate') })
])
export type HostRequest = z.infer<typeof hostRequestSchema>
export const hostResponseSchema = z.strictObject({ requestId: z.string().uuid(), ok: z.boolean(), value: z.unknown().optional() })
