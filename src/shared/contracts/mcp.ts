import { z } from 'zod'

export const assetMcpTokenSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/, '令牌须为 32–128 位字母、数字、下划线或短横线')
export const startAssetMcpSchema = z.object({
  publicVoicesEnabled: z.boolean().default(false),
  projectId: z.string().uuid().nullable(), allProjects: z.boolean().default(false), writeEnabled: z.boolean(),
  minutes: z.union([z.literal(-1), z.number().int().min(5).max(120)]),
  token: assetMcpTokenSchema.optional(), scriptLibraryEnabled: z.boolean().default(false), assemblyEnabled: z.boolean().default(false), imageGenerationEnabled: z.boolean().default(false), imageSubmissionEnabled: z.boolean().default(false)
}).refine((input) => input.allProjects ? input.projectId === null : input.projectId !== null, '请选择单个项目或全部项目')
  .refine((input) => !input.imageSubmissionEnabled || input.imageGenerationEnabled && input.writeEnabled, '生图提交需要同时启用素材生成和写权限')
export type StartAssetMcp = z.input<typeof startAssetMcpSchema>
export const assetMcpPreferencesSchema = z.strictObject({
  publicVoicesEnabled: z.boolean().default(false),
  projectId: z.string().uuid().nullable(), allProjects: z.boolean(), writeEnabled: z.boolean(),
  minutes: startAssetMcpSchema.shape.minutes, importDirectory: z.string().max(2000),
  scriptLibraryEnabled: z.boolean().default(false), assemblyEnabled: z.boolean().default(false), imageGenerationEnabled: z.boolean().default(false), imageSubmissionEnabled: z.boolean().default(false)
})
export type AssetMcpPreferences = z.infer<typeof assetMcpPreferencesSchema>
export interface AssetMcpStatus {
  publicVoicesEnabled?: boolean
  startupError?: string
  enabled: boolean; projectId: string | null; url: string; importDirectory: string;
  allProjects: boolean; writeEnabled: boolean; expiresAt: string | null; scriptLibraryEnabled: boolean; assemblyEnabled: boolean
  imageGenerationEnabled: boolean
  imageSubmissionEnabled: boolean
}
