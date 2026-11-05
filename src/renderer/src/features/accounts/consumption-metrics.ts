import type { TaskConsumption } from '@contracts/consumption'

export function coinsPerSecond(consumption: TaskConsumption | null, seconds: number | null): string | null {
  if (!consumption || consumption.conflictingFields.includes('coins') || consumption.coins === null ||
    seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  const duration = /^(\d+)(?:\.(\d+))?$/.exec(String(seconds))
  if (!duration) return null
  const [integer, fraction = ''] = consumption.coins.split('.')
  const durationFraction = duration[2] ?? ''
  // 费用保留十进制精度；单价四舍五入到四位，避免金额先转浮点数丢失精度。
  const numerator = BigInt(`${integer}${fraction}`) * 10n ** BigInt(durationFraction.length) * 10000n
  const denominator = BigInt(`${duration[1]}${durationFraction}`) * 10n ** BigInt(fraction.length)
  const rounded = (numerator + denominator / 2n) / denominator
  const decimals = (rounded % 10000n).toString().padStart(4, '0').replace(/0+$/, '')
  return `${rounded / 10000n}${decimals ? `.${decimals}` : ''}`
}

export function consumptionSeconds(seconds: number | null): string {
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? `${seconds} 秒` : '未知'
}
