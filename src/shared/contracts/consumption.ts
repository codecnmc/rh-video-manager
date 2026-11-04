import { z } from 'zod'

export const consumptionAmountSchema = z.string().regex(/^\d{1,24}(?:\.\d{1,8})?$/)
export const taskConsumptionSchema = z.object({
  source: z.literal('runninghub-outputs'),
  checkedAt: z.string().datetime(),
  coins: consumptionAmountSchema.nullable(),
  money: consumptionAmountSchema.nullable(),
  thirdPartyMoney: consumptionAmountSchema.nullable(),
  conflictingFields: z.array(z.enum(['coins', 'money', 'thirdPartyMoney'])).max(3)
})
export type TaskConsumption = z.infer<typeof taskConsumptionSchema>

export const consumptionFilterSchema = z.object({
  accountId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
}).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), '结束日期不能早于开始日期')
export type ConsumptionFilter = z.infer<typeof consumptionFilterSchema>

export interface ConsumptionEntry {
  id: string
  taskId: string
  projectId: string
  accountId: string
  workflowId: string
  title: string
  submittedAt: string
  remoteStatus: 'unknown' | 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  consumption: TaskConsumption | null
}

export interface ConsumptionLedger {
  entries: ConsumptionEntry[]
  knownCoins: string | null
  knownCount: number
  unknownCount: number
}
