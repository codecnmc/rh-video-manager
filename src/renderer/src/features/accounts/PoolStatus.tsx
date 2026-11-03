import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCoins, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { getPoolActivity } from './pool-activity'
import { useAccountPoolSync, useAccounts } from './use-accounts'

export function PoolStatus({ onNotice }: { onNotice: (message: string) => void }) {
  const accounts = useAccounts()
  const pool = accounts.data
  const sync = useAccountPoolSync(Boolean(pool?.enabledCount))
  const syncing = sync.isFetching
  const activity = getPoolActivity(pool)
  const state = accounts.error ? '读取失败' : !pool ? '正在读取'
    : pool.enabledCount === 0 ? '无启用账号' : sync.error ? '同步失败' : activity.partial ? '部分同步'
      : pool.queueSyncedCount === pool.enabledCount ? '已同步' : '待同步'
  const ready = Boolean(!sync.error && pool && pool.enabledCount > 0 && pool.queueSyncedCount === pool.enabledCount)

  async function refresh() {
    try { await sync.refetch({ cancelRefetch: false, throwOnError: true }) }
    catch (error) { onNotice(error instanceof Error ? error.message : '账号池同步失败') }
  }

  return <section className="pool-status" aria-label="账号池状态" aria-busy={syncing}>
    <div className="pool-status-heading"><span>账号池状态</span>
      <Button variant="ghost" size="icon" title="同步额度与队列" aria-label="同步额度与队列" disabled={syncing || !pool || pool.enabledCount === 0} onClick={() => void refresh()}>
        <FontAwesomeIcon icon={faRotateRight} spin={syncing} /></Button></div>
    <div className="pool-status-balance" title={`RH 币余额 · 额度已同步 ${pool ? `${pool.syncedCount}/${pool.enabledCount}` : '未读取'}`}>
      <FontAwesomeIcon icon={faCoins} /><strong>{pool?.totalCoins ?? '未同步'}</strong><span>RH 币</span></div>
    <dl className="pool-status-metrics" aria-live="polite">
      <div title={`已同步启用账号的并发上限合计 · 队列同步 ${activity.coverage}`}><dt>并发上限</dt><dd>{activity.concurrency ?? '待同步'}</dd></div>
      <div title="远端运行数，每 30 秒自动同步，不是本地项目任务数"><dt>运行中</dt><dd className={activity.runningTasks ? 'is-running' : ''}>{activity.runningTasks ?? '待同步'}</dd></div>
    </dl>
    <div className={`pool-status-sync ${ready ? 'is-ready' : ''}`} role="status" title={`队列同步 ${activity.coverage} · 最后账号同步快照`}>
      <span className="ready-dot" /><span>{syncing ? '同步中' : state}</span><span className="pool-status-coverage">{pool ? activity.coverage : ''}</span></div>
    {accounts.error && <p className="sr-only" role="alert">账号池读取失败</p>}
  </section>
}
