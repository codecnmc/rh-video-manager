import test from 'node:test'
import assert from 'node:assert/strict'
import { coinsPerSecond, consumptionSeconds } from '../src/renderer/src/features/accounts/consumption-metrics.ts'
import type { TaskConsumption } from '../src/shared/contracts/consumption.ts'

const consumption: TaskConsumption = { source: 'runninghub-outputs', checkedAt: '2026-11-05T00:00:00.000Z',
  coins: '747', money: null, thirdPartyMoney: null, conflictingFields: [] }

test('按视频秒数和运行秒数折算，最多四位小数并保留十进制精度', () => {
  assert.equal(coinsPerSecond(consumption, 12), '62.25')
  assert.equal(coinsPerSecond(consumption, 320.5), '2.3307')
  assert.equal(coinsPerSecond({ ...consumption, coins: '1' }, 6), '0.1667')
  assert.equal(coinsPerSecond({ ...consumption, coins: '0' }, 12), '0')
  assert.equal(coinsPerSecond({ ...consumption, coins: '999999999999999999999999' }, 10), '99999999999999999999999.9')
})

test('缺失或冲突费用、无效时长不折算；缺失时长不伪造为零', () => {
  for (const seconds of [null, 0, -1, NaN, Infinity]) {
    assert.equal(coinsPerSecond(consumption, seconds), null)
    assert.equal(consumptionSeconds(seconds), '未知')
  }
  assert.equal(coinsPerSecond(null, 12), null)
  assert.equal(coinsPerSecond({ ...consumption, coins: null }, 12), null)
  assert.equal(coinsPerSecond({ ...consumption, conflictingFields: ['coins'] }, 12), null)
  assert.equal(consumptionSeconds(320.5), '320.5 秒')
})
