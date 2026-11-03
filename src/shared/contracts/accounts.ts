import { z } from 'zod'

export const entityIdSchema = z.object({ id: z.string().uuid() })
export const saveAccountSchema = z.object({
  id: z.string().uuid().nullable(), name: z.string().trim().min(1).max(100),
  identity: z.string().trim().min(1).max(100), apiKey: z.string().trim().max(512),
  concurrency: z.number().int().nonnegative().safe(), enabled: z.boolean()
}).refine((value) => value.id !== null || value.apiKey.length >= 10, { path: ['apiKey'], message: '请输入 API Key' })
export type SaveAccount = z.infer<typeof saveAccountSchema>
export interface AccountBalance {
  coins: string; money: string | null; currency: string | null; runningTasks: number; apiType: string
}
export const accountQueueSchema = z.object({
  apiKeyType: z.string().min(1).max(100),
  concurrentLimit: z.number().int().nonnegative().safe(),
  runningCount: z.number().int().nonnegative().safe(),
  queuedCount: z.number().int().nonnegative().safe(),
  totalCurrentTasks: z.number().int().nonnegative().safe()
})
export type AccountQueue = z.infer<typeof accountQueueSchema>
export interface Account {
  id: string; name: string; identity: string; keyHint: string; concurrency: number; enabled: boolean
  balance: AccountBalance | null; status: 'unknown' | 'ready' | 'error'; checkedAt: string | null; error: string
  queue: AccountQueue | null; queueStatus: 'unknown' | 'ready' | 'error'; queueCheckedAt: string | null; queueError: string
}
export interface AccountPool {
  accounts: Account[]; enabledCount: number; syncedCount: number; totalCoins: string | null
  wallets: { currency: string; amount: string }[]; concurrency: number; runningTasks: number | null
  queueSyncedCount: number; remoteConcurrency: number | null; queuedTasks: number | null
  totalCurrentTasks: number | null; availableSlots: number | null
}
