import { z } from 'zod'
import { consumptionAmountSchema } from '../../../shared/contracts/consumption'

export function parseWorkflowUsage(value: unknown): { points: string | null; executionSeconds: number | null } {
  const parsed = z.object({ chargedPoint: z.unknown().optional(), taskCostTime: z.unknown().optional() }).safeParse(value)
  if (!parsed.success) return { points: null, executionSeconds: null }
  const rawPoints = parsed.data.chargedPoint
  const amount = consumptionAmountSchema.safeParse(typeof rawPoints === 'number' && Number.isFinite(rawPoints) && rawPoints <= Number.MAX_SAFE_INTEGER ? String(rawPoints) : rawPoints)
  const time = parsed.data.taskCostTime
  const seconds = typeof time === 'number' ? time : typeof time === 'string' && /^\d+(?:\.\d+)?$/.test(time) ? Number(time) : NaN
  // usage 是任务级汇总；不再累加 taskUsageList 中可能重复的父子任务费用。
  return { points: amount.success ? amount.data : null, executionSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null }
}
