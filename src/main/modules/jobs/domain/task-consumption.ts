import type { TaskConsumption } from '../../../../shared/contracts/consumption'

export function mergeTaskConsumption(previous: TaskConsumption | undefined, incoming: TaskConsumption): TaskConsumption {
  if (!previous) return incoming
  if (Date.parse(previous.checkedAt) > Date.parse(incoming.checkedAt)) return previous
  const next = { ...incoming }
  // 兼容接口过期后可能返回空数据；保留已确认数值，但新响应明确冲突时不能沿用旧值冒充确认。
  for (const field of ['points', 'coins', 'money', 'thirdPartyMoney'] as const) {
    if (next[field] === null && !next.conflictingFields.includes(field)) next[field] = previous[field] ?? null
  }
  next.conflictingFields = [...new Set([...next.conflictingFields,
    ...previous.conflictingFields.filter((field) => next[field] === null)])]
  return next
}
