import type { AccountPool } from '../../../../shared/contracts/accounts'

type ActivityPool = Pick<AccountPool, 'enabledCount' | 'queueSyncedCount' | 'remoteConcurrency' | 'runningTasks'>

export function getPoolActivity(pool: ActivityPool | undefined) {
  const empty = pool?.enabledCount === 0
  return {
    concurrency: empty ? 0 : pool?.remoteConcurrency ?? null,
    runningTasks: empty ? 0 : pool?.runningTasks ?? null,
    partial: Boolean(pool && pool.queueSyncedCount > 0 && pool.queueSyncedCount < pool.enabledCount),
    coverage: pool ? `${pool.queueSyncedCount}/${pool.enabledCount}` : '未读取'
  }
}
