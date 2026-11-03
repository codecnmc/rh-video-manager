import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { parseQueueStatus, RunningHubAccountGateway } from '../src/main/providers/runninghub/account-gateway.ts'
import { SqliteAccountRepository } from '../src/main/infrastructure/database/account-repository.ts'
import { AccountService } from '../src/main/modules/accounts/application/account-service.ts'
import { saveAccountSchema } from '../src/shared/contracts/accounts.ts'

const data = { apiKeyType: 'EXCLUSIVE', concurrentLimit: 30, runningCount: '9', queuedCount: '0', totalCurrentTasks: '9' }

test('官方队列响应中的字符串数量转为安全非负整数，保留未知 Key 类型', () => {
  assert.deepEqual(parseQueueStatus({ code: 0, data }), { ...data, runningCount: 9, queuedCount: 0, totalCurrentTasks: 9 })
  assert.equal(parseQueueStatus({ code: 0, data: { ...data, apiKeyType: 'FUTURE', concurrentLimit: 0 } }).apiKeyType, 'FUTURE')
  for (const invalid of ['-1', '1.5', '1e3', 'NaN', '', '9007199254740992', 9, null]) {
    assert.throws(() => parseQueueStatus({ code: 0, data: { ...data, runningCount: invalid } }))
  }
  assert.throws(() => parseQueueStatus({ code: 807, data }))
  assert.throws(() => parseQueueStatus({ code: 0, data: { ...data, concurrentLimit: -1 } }))
  assert.throws(() => parseQueueStatus({ code: 0, data: { ...data, concurrentLimit: 1.5 } }))
  assert.throws(() => parseQueueStatus({ code: 0, data: { ...data, queuedCount: undefined } }))
})

test('队列查询仅以 GET Bearer 认证，拒绝 HTTP 错误、业务错误与超大响应', async () => {
  const original = globalThis.fetch
  const requests: { url: string; init: RequestInit | undefined }[] = []
  let response = new Response(JSON.stringify({ code: 0, data }))
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return response }
  try {
    const gateway = new RunningHubAccountGateway()
    assert.equal((await gateway.queue('test-only-key')).runningCount, 9)
    assert.equal(requests[0]?.url, 'https://www.runninghub.cn/openapi/v2/queue/status')
    assert.equal(requests[0]?.init?.method, 'GET')
    assert.equal(requests[0]?.init?.body, undefined)
    assert.equal(new Headers(requests[0]?.init?.headers).get('Authorization'), 'Bearer test-only-key')
    response = new Response('{}', { status: 403 })
    await assert.rejects(gateway.queue('test-only-key'))
    response = new Response(JSON.stringify({ code: 807, data }))
    await assert.rejects(gateway.queue('test-only-key'))
    response = new Response(' '.repeat(65537))
    await assert.rejects(gateway.queue('test-only-key'), /响应过大/)
  } finally { globalThis.fetch = original }
})

test('旧 SQLite 账号兼容读取，同步的并发与队列均持久化并可重读', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY, identity TEXT, key_fingerprint TEXT, key_cipher BLOB, data TEXT)')
    const legacy = { id: '00000000-0000-4000-8000-000000000001', name: '账号', identity: 'identity', keyHint: '****',
      concurrency: 2, enabled: true, status: 'unknown', checkedAt: null, error: '', balance: null }
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)').run(legacy.id, legacy.identity, 'test-fingerprint', new Uint8Array([1]), JSON.stringify(legacy))
    const repository = new SqliteAccountRepository(db)
    const account = repository.list()[0]!
    assert.equal(account.queue, null)
    assert.equal(account.queueStatus, 'unknown')
    assert.equal(account.queueCheckedAt, null)
    assert.equal(account.concurrency, 2)
    repository.save({ ...account, queue: parseQueueStatus({ code: 0, data }), queueStatus: 'ready', queueCheckedAt: '2026-10-19T00:00:00Z' })
    assert.equal(repository.list()[0]?.queue?.concurrentLimit, 30)
    const service = new AccountService(repository, { seal: () => { throw new Error('not used') }, open: () => 'test-only-key' }, {
      status: async () => ({ coins: '1', money: null, currency: null, runningTasks: 0, apiType: 'test' }),
      queue: async () => parseQueueStatus({ code: 0, data })
    }, () => { throw new Error('not used') })
    await service.refresh(legacy.id)
    const reloaded = new SqliteAccountRepository(db).list()[0]!
    assert.equal(reloaded.concurrency, 30)
    assert.equal(reloaded.queue?.concurrentLimit, 30)
  } finally { db.close() }
})

test('账号边界接纳远端零并发和大于一百的并发，拒绝无效数字', () => {
  const input = { id: null, name: '账号', identity: 'identity', apiKey: 'test-only-key', enabled: true }
  for (const concurrency of [0, 1, 300]) assert.equal(saveAccountSchema.parse({ ...input, concurrency }).concurrency, concurrency)
  for (const concurrency of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(saveAccountSchema.safeParse({ ...input, concurrency }).success, false)
  }
})
