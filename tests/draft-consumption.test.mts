import test from 'node:test'
import assert from 'node:assert/strict'
import { recordConsumptionLabel, summarizeDraftConsumption } from '../src/renderer/src/features/workbench/draft-consumption.ts'

type Record = Parameters<typeof recordConsumptionLabel>[0]
function record(taskId: string, coins: string | null = null, overrides: Partial<Record> = {}): Record {
  return { taskId, accountId: 'account-a', remoteStatus: 'success', consumption: {
    source: 'runninghub-outputs', checkedAt: '2026-11-05T00:00:00.000Z', coins,
    money: '100', thirdPartyMoney: '20', conflictingFields: []
  }, ...overrides }
}

test('同草稿多次生成累计耗币，精确相加且不混入其他费用', () => {
  const summary = summarizeDraftConsumption([record('12345678', '0.1'), record('12345679', '0.2')])
  assert.equal(summary.knownCoins, '0.3')
  assert.equal(summary.knownCount, 2)
  assert.equal(summarizeDraftConsumption([record('12345678', '999999999999999999999999.99999999'), record('12345679', '0.00000001')]).knownCoins, '1000000000000000000000000')
})

test('同账号远端任务去重并取最近费用，不同账号不合并', () => {
  const old = record('12345678', '10')
  const latest = record('12345678', '12', { consumption: { ...old.consumption!, coins: '12', checkedAt: '2026-11-05T01:00:00.000Z' } })
  const summary = summarizeDraftConsumption([latest, old, record('12345678', '3', { accountId: 'account-b' })])
  assert.equal(summary.knownCoins, '15')
  assert.equal(summary.knownCount, 2)
})

test('缺失、冲突和未结算分别标记，不把未知计成零', () => {
  const conflict = record('12345679', '99')
  conflict.consumption!.conflictingFields = ['coins']
  const pending = record('12345680', null, { remoteStatus: 'running' })
  const summary = summarizeDraftConsumption([record('12345678'), conflict, pending, record('')])
  assert.deepEqual(summary, { knownCoins: null, knownCount: 0, unknownCount: 1, conflictingCount: 1, pendingCount: 1 })
  assert.equal(recordConsumptionLabel(conflict), '数据冲突')
  assert.equal(recordConsumptionLabel(pending), '未结算')
  assert.equal(recordConsumptionLabel(record('12345678')), '待查询')
  assert.equal(recordConsumptionLabel(record('')), '未提交')
  assert.equal(recordConsumptionLabel(record('12345678', '0')), '0 RH 币')
  assert.equal(summarizeDraftConsumption([record('12345678', '0')]).knownCoins, '0')
  assert.equal(summarizeDraftConsumption([]).knownCoins, null)
})

test('失败或取消记录有平台耗币时仍计入累计，不擅自假定退款', () => {
  assert.equal(summarizeDraftConsumption([record('12345678', '2', { remoteStatus: 'failed' }),
    record('12345679', '3', { remoteStatus: 'cancelled' })]).knownCoins, '5')
})
