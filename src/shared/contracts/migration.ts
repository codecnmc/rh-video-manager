import { z } from 'zod'

export const migrationPasswordSchema = z.object({ password: z.string().min(12).max(256) })
