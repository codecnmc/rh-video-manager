import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService, sumDecimals } from '../src/main/modules/accounts/application/account-service.ts'
import type { AccountGateway, AccountRecord, AccountRepository, CredentialVault } from '../src/main/modules/accounts/ports/accounts.ts'

const emptyQueue = { apiKeyType: 'NORMAL', concurrentLimit: 3, runningCount: 0, queuedCount: 0, totalCurrentTasks: 0 }
function setup(gateway: Pick<AccountGateway, 'status'> & Partial<Pick<AccountGateway, 'queue'>>) {
  const rows = new Map<string, AccountRecord>()
  const repository: AccountRepository = { list: () => [...rows.values()], save: (row) => { rows.set(row.id, row) }, remove: (id) => { rows.delete(id) } }
  const vault: CredentialVault = {
    seal: (key) => ({ cipher: new TextEncoder().encode(key), fingerprint: key, keyHint: '****' }),
    open: (cipher) => new TextDecoder().decode(cipher)
  }
  let sequence = 0
  return { rows, service: new AccountService(repository, vault, { queue: async () => ({ ...emptyQueue }), ...gateway }, () => `account-${++sequence}`) }
}

test('额度按十进制定点累加，不引入浮点误差', () => {
  assert.equal(sumDecimals(['0.1', '0.2', '0.00000001']), '0.30000001')
  assert.equal(sumDecimals(['-1.25', '0.25']), '-1')
  assert.throws(() => sumDecimals(['1e10']))
})

test('拒绝重复账号标识或 Key；公开快照不含凭据', async () => {
  const { service } = setup({ status: async () => ({ coins: '1', money: null, currency: null, runningTasks: 0, apiType: 'test' }) })
  const input = { id: null, name: '账号 A', identity: 'identity-a', apiKey: 'test-key-a-12345', concurrency: 2, enabled: true }
  const first = service.save(input).accounts[0]!
  assert.throws(() => service.save({ ...input, apiKey: 'another-test-key' }))
  assert.throws(() => service.save({ ...input, identity: 'different-identity' }))
  const edited = service.save({ ...input, id: first.id, apiKey: '', name: '改名' })
  assert.equal(edited.accounts[0]?.name, '改名')
  assert.equal(service.credential(first.id), input.apiKey)
  assert.equal(JSON.stringify(edited).includes(input.apiKey), false)
  assert.equal('cipher' in edited.accounts[0]!, false)
  assert.equal('fingerprint' in edited.accounts[0]!, false)
})

test('汇总排除失败及停用账号，钱包不跨币种相加', async () => {
  const { service } = setup({ status: async (key) => {
    if (key === 'test-key-failed') throw new Error('offline')
    return { coins: '0.1', money: '2.3', currency: key.endsWith('usd') ? 'USD' : 'CNY', runningTasks: 1, apiType: 'test' }
  }, queue: async (key) => {
    if (key === 'test-key-failed') throw new Error('offline')
    return { ...emptyQueue, runningCount: 1, totalCurrentTasks: 1 }
  } })
  for (const suffix of ['cny', 'usd', 'failed', 'disabled']) service.save({ id: null, name: suffix, identity: suffix,
    apiKey: `test-key-${suffix}`, concurrency: 2, enabled: suffix !== 'disabled' })
  const pool = await service.refresh(null)
  assert.equal(pool.totalCoins, '0.2')
  assert.equal(pool.enabledCount, 3)
  assert.equal(pool.syncedCount, 2)
  assert.equal(pool.concurrency, 8)
  assert.equal(pool.remoteConcurrency, 6)
  assert.equal(pool.runningTasks, 2)
  assert.deepEqual(pool.wallets, [{ currency: 'CNY', amount: '2.3' }, { currency: 'USD', amount: '2.3' }])
})

test('同步中的旧 Key 响应不得覆盖替换后的账号', async () => {
  let resolve: (value: { coins: string; money: null; currency: null; runningTasks: number; apiType: string }) => void = () => undefined
  const { service } = setup({ status: () => new Promise((done) => { resolve = done }) })
  const input = { id: null, name: '账号', identity: 'identity', apiKey: 'old-test-key', concurrency: 1, enabled: true }
  const account = service.save(input).accounts[0]!
  const refreshing = service.refresh(account.id)
  service.save({ ...input, id: account.id, apiKey: 'new-test-key' })
  resolve({ coins: '99', money: null, currency: null, runningTasks: 0, apiType: 'test' })
  await refreshing
  assert.equal(service.list().accounts[0]?.balance, null)
  assert.equal(service.list().accounts[0]?.queue, null)
  assert.equal(service.list().accounts[0]?.concurrency, 0)
})

test('未提供钱包金额时不合成零余额钱包', async () => {
  const { service } = setup({ status: async () => ({ coins: '1', money: null, currency: 'USD', runningTasks: 0, apiType: 'test' }) })
  service.save({ id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', concurrency: 1, enabled: true })
  assert.deepEqual((await service.refresh(null)).wallets, [])
})

test('额度失败仍可同步队列，并将远端并发更新到本地', async () => {
  const { service } = setup({
    status: async () => { throw new Error('balance unavailable') },
    queue: async () => ({ ...emptyQueue, concurrentLimit: 30, runningCount: 9, queuedCount: 4, totalCurrentTasks: 13 })
  })
  service.save({ id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', concurrency: 2, enabled: true })
  const pool = await service.refresh(null)
  assert.equal(pool.totalCoins, null)
  assert.equal(pool.syncedCount, 0)
  assert.equal(pool.queueSyncedCount, 1)
  assert.equal(pool.concurrency, 30)
  assert.equal(pool.accounts[0]?.concurrency, 30)
  assert.equal(pool.remoteConcurrency, 30)
  assert.equal(pool.runningTasks, 9)
  assert.equal(pool.queuedTasks, 4)
  assert.equal(pool.totalCurrentTasks, 13)
  assert.equal(pool.availableSlots, 21)
})

test('队列失败保留旧快照但排除汇总，不影响额度', async () => {
  let failed = false
  const { service } = setup({
    status: async () => ({ coins: '10', money: null, currency: null, runningTasks: 99, apiType: 'test' }),
    queue: async () => {
      if (failed) throw new Error('sensitive remote error')
      return { ...emptyQueue, concurrentLimit: 1, runningCount: 2, totalCurrentTasks: 2 }
    }
  })
  service.save({ id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', concurrency: 3, enabled: true })
  const first = await service.refresh(null)
  assert.equal(first.availableSlots, 0)
  assert.equal(first.runningTasks, 2)
  failed = true
  const pool = await service.refresh(null)
  assert.equal(pool.totalCoins, '10')
  assert.equal(pool.queueSyncedCount, 0)
  assert.equal(pool.remoteConcurrency, null)
  assert.equal(pool.runningTasks, null)
  assert.equal(pool.queuedTasks, null)
  assert.equal(pool.availableSlots, null)
  assert.equal(pool.accounts[0]?.queueStatus, 'error')
  assert.equal(pool.accounts[0]?.concurrency, 1)
  assert.equal(pool.accounts[0]?.queue?.runningCount, 2)
  assert.equal(pool.accounts[0]?.queueCheckedAt, first.accounts[0]?.queueCheckedAt)
  assert.equal(JSON.stringify(pool).includes('sensitive remote error'), false)
})

test('同一账号的同步合并，删除账号后丢弃迟到队列响应', async () => {
  let finish: () => void = () => undefined
  let calls = 0
  const wait = new Promise<void>((resolve) => { finish = resolve })
  const { service } = setup({
    status: async () => ({ coins: '1', money: null, currency: null, runningTasks: 0, apiType: 'test' }),
    queue: async () => { calls += 1; await wait; return { ...emptyQueue } }
  })
  const account = service.save({ id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', concurrency: 1, enabled: true }).accounts[0]!
  const first = service.refresh(account.id)
  const second = service.refresh(account.id)
  service.remove(account.id)
  finish()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(service.list().accounts.length, 0)
})

test('并发按远端升降，支持零与大于一百；旧编辑输入不能覆盖同步结果', async () => {
  let limit = 1
  let failed = false
  const { service, rows } = setup({
    status: async () => ({ coins: '1', money: null, currency: null, runningTasks: 0, apiType: 'test' }),
    queue: async () => {
      if (failed) throw new Error('offline')
      return { ...emptyQueue, concurrentLimit: limit }
    }
  })
  const input = { id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', concurrency: 3, enabled: true }
  const account = service.save(input).accounts[0]!
  for (const next of [1, 3, 300, 0]) {
    limit = next
    const pool = await service.refresh(account.id)
    assert.equal(pool.concurrency, next)
    assert.equal(rows.get(account.id)?.concurrency, next)
    assert.equal(service.save({ ...input, id: account.id, apiKey: '', name: '编辑名称' }).accounts[0]?.concurrency, next)
  }
  failed = true
  await service.refresh(account.id)
  assert.equal(service.save({ ...input, id: account.id, apiKey: '' }).accounts[0]?.concurrency, 0)
})
