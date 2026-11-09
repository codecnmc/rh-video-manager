import { z } from 'zod'
import { consumptionAmountSchema, type TaskConsumption } from '../../../shared/contracts/consumption'

const rowsSchema = z.array(z.record(z.string(), z.unknown())).max(5000)
const fields = { points: 'chargedPoint', coins: 'consumeCoins', money: 'consumeMoney', thirdPartyMoney: 'thirdPartyConsumeMoney' } as const

export function parseTaskConsumption(data: unknown, checkedAt = new Date().toISOString()): TaskConsumption {
  const rows = rowsSchema.parse(data)
  const result: TaskConsumption = { source: 'runninghub-outputs', checkedAt,
    points: null, coins: null, money: null, thirdPartyMoney: null, conflictingFields: [] }
  for (const field of ['points', 'coins', 'money', 'thirdPartyMoney'] as const) {
    const values = new Set<string>()
    let invalid = false
    for (const row of rows) {
      const raw = row[fields[field]]
      if (raw === undefined || raw === null) continue
      const parsed = consumptionAmountSchema.safeParse(typeof raw === 'number' && Number.isFinite(raw) && raw <= Number.MAX_SAFE_INTEGER ? String(raw) : raw)
      if (!parsed.success) { invalid = true; continue }
      const [integer = '0', fraction = ''] = parsed.data.split('.')
      const decimals = fraction.replace(/0+$/, '')
      const normalized = `${integer.replace(/^0+(?=\d)/, '')}${decimals ? `.${decimals}` : ''}`
      values.add(normalized)
    }
    // outputs 每个文件都可能重复携带任务费用；仅采纳一致值，不按文件数累加或猜测冲突值。
    if (invalid || values.size > 1) result.conflictingFields.push(field)
    else result[field] = values.values().next().value ?? null
  }
  return result
}
