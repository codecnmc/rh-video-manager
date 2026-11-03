import test from 'node:test'
import assert from 'node:assert/strict'
import { getPoolActivity } from '../src/renderer/src/features/accounts/pool-activity.ts'

test('状态区未读取或队列未知时不伪造零并发与零运行', () => {
  assert.deepEqual(getPoolActivity(undefined), { concurrency: null, runningTasks: null, partial: false, coverage: '未读取' })
  assert.deepEqual(getPoolActivity({ enabledCount: 1, queueSyncedCount: 0, remoteConcurrency: null, runningTasks: null }),
    { concurrency: null, runningTasks: null, partial: false, coverage: '0/1' })
})

test('状态区显示已同步的并发和运行数，部分同步必须标记', () => {
  const pool = { enabledCount: 2, queueSyncedCount: 1, remoteConcurrency: 3, runningTasks: 2 }
  assert.deepEqual(getPoolActivity(pool), { concurrency: 3, runningTasks: 2, partial: true, coverage: '1/2' })
  assert.deepEqual(getPoolActivity({ ...pool, queueSyncedCount: 2, remoteConcurrency: 6, runningTasks: 0 }),
    { concurrency: 6, runningTasks: 0, partial: false, coverage: '2/2' })
})

test('没有启用账号时并发与运行均为零', () => {
  assert.deepEqual(getPoolActivity({ enabledCount: 0, queueSyncedCount: 0, remoteConcurrency: null, runningTasks: null }),
    { concurrency: 0, runningTasks: 0, partial: false, coverage: '0/0' })
})
