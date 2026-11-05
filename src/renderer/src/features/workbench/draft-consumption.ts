import type { PreviewSnapshot } from '@contracts/preview'

type ConsumptionRecord = Pick<PreviewSnapshot, 'accountId' | 'taskId' | 'remoteStatus' | 'consumption'>

function settled(record: ConsumptionRecord): boolean {
  return ['success', 'failed', 'cancelled'].includes(record.remoteStatus)
}

export function recordConsumptionLabel(record: ConsumptionRecord): string {
  if (!/^\d{8,30}$/.test(record.taskId)) return '未提交'
  if (record.consumption?.conflictingFields.includes('coins')) return '数据冲突'
  if (record.consumption?.coins != null) return `${record.consumption.coins} RH 币`
  return settled(record) ? '待查询' : '未结算'
}

export function summarizeDraftConsumption(records: readonly ConsumptionRecord[]) {
  // 同账号同远端任务仅计一次；重复快照优先采用最近查询的费用。
  const unique = new Map<string, ConsumptionRecord>()
  for (const record of records) {
    if (!/^\d{8,30}$/.test(record.taskId)) continue
    const key = `${record.accountId}/${record.taskId}`
    const previous = unique.get(key)
    if (!previous || (record.consumption?.checkedAt ?? '') > (previous.consumption?.checkedAt ?? '')) unique.set(key, record)
  }
  let total = 0n, knownCount = 0, unknownCount = 0, conflictingCount = 0, pendingCount = 0
  for (const record of unique.values()) {
    if (record.consumption?.conflictingFields.includes('coins')) { conflictingCount++; continue }
    const coins = record.consumption?.coins
    if (coins == null) {
      if (settled(record)) unknownCount++
      else pendingCount++
      continue
    }
    // 平台金额最多八位小数，使用定点整数相加，避免浮点误差及大额精度损失。
    const [integer = '0', fraction = ''] = coins.split('.')
    total += BigInt(integer) * 100000000n + BigInt(fraction.padEnd(8, '0'))
    knownCount++
  }
  const fraction = (total % 100000000n).toString().padStart(8, '0').replace(/0+$/, '')
  return { knownCoins: knownCount ? `${total / 100000000n}${fraction ? `.${fraction}` : ''}` : null,
    knownCount, unknownCount, conflictingCount, pendingCount }
}
