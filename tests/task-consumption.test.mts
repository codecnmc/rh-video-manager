import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskConsumption } from '../src/main/providers/runninghub/task-consumption.ts'
import { mergeTaskConsumption } from '../src/main/modules/jobs/domain/task-consumption.ts'
import { RunningHubGenerationGateway } from '../src/main/providers/runninghub/generation-gateway.ts'
import { taskConsumptionSchema, consumptionFilterSchema } from '../src/shared/contracts/consumption.ts'

const checkedAt = '2026-11-04T01:00:00.000Z'

test('文档返回的每个输出重复耗币，只记录一次任务费用，金额不折算为 RH 币', () => {
  const value = parseTaskConsumption([
    { consumeCoins: '017.00', consumeMoney: '0.10', thirdPartyConsumeMoney: null, taskCostTime: '83' },
    { consumeCoins: '17', consumeMoney: '0.1', thirdPartyConsumeMoney: null, taskCostTime: '83' }
  ], checkedAt)
  assert.deepEqual(value, { source: 'runninghub-outputs', checkedAt, points: null, coins: '17', money: '0.1', thirdPartyMoney: null, conflictingFields: [] })
  assert.deepEqual(taskConsumptionSchema.parse(value), value)
})

test('空结果、缺失与 null 都为未知；真实零值不丢失', () => {
  assert.equal(parseTaskConsumption([], checkedAt).coins, null)
  assert.equal(parseTaskConsumption([{ consumeCoins: null, taskCostTime: '83' }], checkedAt).coins, null)
  assert.equal(parseTaskConsumption([{ consumeCoins: '0', consumeMoney: 0 }], checkedAt).coins, '0')
  assert.equal(parseTaskConsumption([{ consumeMoney: 0 }], checkedAt).money, '0')
})

test('多个输出冲突、负数、科学计数法及过大数值不猜测，其他费用仍独立保留', () => {
  const value = parseTaskConsumption([{ consumeCoins: '17', consumeMoney: '-1', thirdPartyConsumeMoney: '0.2' },
    { consumeCoins: '18', consumeMoney: '1', thirdPartyConsumeMoney: '0.20' }], checkedAt)
  assert.deepEqual(value.conflictingFields, ['coins', 'money'])
  assert.equal(value.coins, null)
  assert.equal(value.money, null)
  assert.equal(value.thirdPartyMoney, '0.2')
  for (const invalid of ['1e3', 'NaN', '', true, '0.123456789', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseTaskConsumption([{ consumeCoins: invalid }], checkedAt).coins, null)
    assert.deepEqual(parseTaskConsumption([{ consumeCoins: invalid }], checkedAt).conflictingFields, ['coins'])
  }
})

test('补查空结果不会抹掉已知费用，明确冲突不沿用旧值，旧事件不回滚新数据', () => {
  const previous = parseTaskConsumption([{ consumeCoins: '17' }], checkedAt)
  const empty = parseTaskConsumption([], '2026-11-04T02:00:00.000Z')
  assert.equal(mergeTaskConsumption(previous, empty).coins, '17')
  const conflict = parseTaskConsumption([{ consumeCoins: '17' }, { consumeCoins: '18' }], empty.checkedAt)
  assert.equal(mergeTaskConsumption(previous, conflict).coins, null)
  assert.deepEqual(mergeTaskConsumption(conflict, previous), conflict)
})

test('历史费用查询只请求 outputs，拒绝接口业务错误，不泄露 Key 或原始响应', async () => {
  const originalFetch = globalThis.fetch
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ code: 0, data: [{ consumeCoins: '17' }] }))
  }
  try {
    const gateway = new RunningHubGenerationGateway()
    const value = await gateway.queryConsumption('1234567890123456789', 'test-only-key')
    assert.equal(value.coins, '17')
    assert.deepEqual(calls, [{ url: 'https://www.runninghub.cn/task/openapi/outputs', body: { apiKey: 'test-only-key', taskId: '1234567890123456789' } }])
    assert.equal(JSON.stringify(value).includes('test-only-key'), false)
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 1, data: 'test-only-key' }))
    await assert.rejects(gateway.queryConsumption('1234567890123456789', 'test-only-key'), (error: unknown) =>
      error instanceof Error && error.message.includes('未重新生成') && !error.message.includes('test-only-key'))
  } finally { globalThis.fetch = originalFetch }
})

test('消费日期范围校验按时间比较而非 ISO 小数秒字符串顺序', () => {
  assert.equal(consumptionFilterSchema.safeParse({ from: '2026-11-04T00:00:00Z', to: '2026-11-04T00:00:00.100Z' }).success, true)
  assert.equal(consumptionFilterSchema.safeParse({ from: '2026-11-05T00:00:00Z', to: '2026-11-04T00:00:00Z' }).success, false)
})

test('积分结算采用 chargedPoint，重复输出只计一次，旧 RH 币不作为积分', () => {
  const value = parseTaskConsumption([
    { settleMode: 'POINT', chargedPoint: '18.36', consumeCoins: null, consumeMoney: null },
    { settleMode: 'POINT', chargedPoint: '18.360', consumeCoins: null }
  ], checkedAt)
  assert.equal(value.points, '18.36')
  assert.equal(value.coins, null)
  assert.equal(parseTaskConsumption([{ chargedPoint: '0' }]).points, '0')
  assert.equal(parseTaskConsumption([{ consumeCoins: '18.36' }]).points, null)
  const conflict = parseTaskConsumption([{ chargedPoint: '18.36' }, { chargedPoint: '19' }])
  assert.equal(conflict.points, null)
  assert.deepEqual(conflict.conflictingFields, ['points'])
  const old = taskConsumptionSchema.parse({ source: 'runninghub-outputs', checkedAt, coins: '17', money: null, thirdPartyMoney: null, conflictingFields: [] })
  assert.equal(old.points, null)
  assert.equal(mergeTaskConsumption(old, value).points, '18.36')
  assert.equal(mergeTaskConsumption(value, parseTaskConsumption([], '2026-11-05T00:00:00.000Z')).points, '18.36')
})
