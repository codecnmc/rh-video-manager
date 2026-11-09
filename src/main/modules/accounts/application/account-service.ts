import type { Account, AccountPool, SaveAccount } from '../../../../shared/contracts/accounts'
import type { AccountGateway, AccountRecord, AccountRepository, CredentialVault } from '../ports/accounts'

export function sumDecimals(values: string[]): string {
  const scale = 100000000n
  const total = values.reduce((sum, value) => {
    if (!/^-?\d+(?:\.\d{1,8})?$/.test(value)) throw new Error('额度格式不正确')
    const negative = value.startsWith('-')
    const [integer = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.')
    const amount = BigInt(integer) * scale + BigInt(fraction.padEnd(8, '0'))
    return sum + (negative ? -amount : amount)
  }, 0n)
  const absolute = total < 0n ? -total : total
  const fraction = (absolute % scale).toString().padStart(8, '0').replace(/0+$/, '')
  return `${total < 0n ? '-' : ''}${absolute / scale}${fraction ? `.${fraction}` : ''}`
}

export class AccountService {
  private readonly pending = new Map<string, Promise<void>>()
  constructor(private readonly repository: AccountRepository, private readonly vault: CredentialVault,
    private readonly gateway: AccountGateway, private readonly id: () => string) {}

  list(): AccountPool {
    const accounts: Account[] = this.repository.list().map(({ cipher: _cipher, fingerprint: _fingerprint, ...account }) => account)
    const enabled = accounts.filter((account) => account.enabled)
    const synced = enabled.filter((account) => account.status === 'ready' && account.balance)
    const queued = enabled.flatMap((account) => account.queueStatus === 'ready' && account.queue ? [account.queue] : [])
    const currencies = new Set(synced.flatMap((account) => account.balance?.currency && account.balance.money !== null ? [account.balance.currency] : []))
    return {
      accounts, enabledCount: enabled.length, syncedCount: synced.length,
      totalPoints: synced.length ? sumDecimals(synced.map((account) => account.balance?.points ?? '0')) : null,
      wallets: [...currencies].map((currency) => ({ currency, amount: sumDecimals(synced.flatMap((account) =>
        account.balance?.currency === currency && account.balance.money !== null ? [account.balance.money] : [])) })),
      concurrency: enabled.reduce((total, account) => total + account.concurrency, 0),
      queueSyncedCount: queued.length,
      remoteConcurrency: queued.length ? queued.reduce((total, queue) => total + queue.concurrentLimit, 0) : null,
      runningTasks: queued.length ? queued.reduce((total, queue) => total + queue.runningCount, 0) : null,
      queuedTasks: queued.length ? queued.reduce((total, queue) => total + queue.queuedCount, 0) : null,
      totalCurrentTasks: queued.length ? queued.reduce((total, queue) => total + queue.totalCurrentTasks, 0) : null,
      availableSlots: queued.length ? queued.reduce((total, queue) => total + Math.max(0, queue.concurrentLimit - queue.runningCount), 0) : null
    }
  }

  private get(id: string): AccountRecord {
    const account = this.repository.list().find((item) => item.id === id)
    if (!account) throw new Error('账号配置不存在')
    return account
  }

  credential(id: string): string {
    const account = this.get(id)
    if (!account.enabled) throw new Error('账号已停用')
    return this.vault.open(account.cipher)
  }

  save(input: SaveAccount): AccountPool {
    const existing = input.id ? this.get(input.id) : null
    if (input.apiKey && input.apiKey.length < 10) throw new Error('API Key 长度不正确')
    const secret = input.apiKey ? this.vault.seal(input.apiKey) : existing
    if (!secret) throw new Error('请输入 API Key')
    if (this.repository.list().some((account) => account.id !== input.id &&
      (account.identity === input.identity || account.fingerprint === secret.fingerprint))) throw new Error('账号标识或 API Key 已存在，请编辑原账号')
    const changed = !existing || secret.fingerprint !== existing.fingerprint
    // 已同步的上限以远端为准，旧表单保存不得将它写回手动旧值。
    const concurrency = existing && !changed
      ? existing.queueStatus === 'ready' && existing.queue ? existing.queue.concurrentLimit : existing.concurrency
      : existing ? 0 : input.concurrency
    this.repository.save({
      id: input.id ?? this.id(), name: input.name, identity: input.identity, enabled: input.enabled,
      concurrency, cipher: secret.cipher, fingerprint: secret.fingerprint, keyHint: secret.keyHint,
      balance: changed ? null : existing?.balance ?? null, status: changed ? 'unknown' : existing?.status ?? 'unknown',
      checkedAt: changed ? null : existing?.checkedAt ?? null, error: changed ? '' : existing?.error ?? '',
      queue: changed ? null : existing?.queue ?? null, queueStatus: changed ? 'unknown' : existing?.queueStatus ?? 'unknown',
      queueCheckedAt: changed ? null : existing?.queueCheckedAt ?? null, queueError: changed ? '' : existing?.queueError ?? ''
    })
    return this.list()
  }

  remove(id: string): AccountPool { this.get(id); this.repository.remove(id); return this.list() }

  async refresh(id: string | null): Promise<AccountPool> {
    const targets = id ? [this.get(id)] : this.repository.list().filter((account) => account.enabled)
    for (const target of targets) {
      let pending = this.pending.get(target.id)
      if (!pending) {
        pending = this.refreshOne(target).finally(() => this.pending.delete(target.id))
        this.pending.set(target.id, pending)
      }
      await pending
    }
    return this.list()
  }

  private async refreshOne(original: AccountRecord): Promise<void> {
    try {
      const key = this.vault.open(original.cipher)
      // 两个接口独立结算，队列失败不得丢弃成功取得的额度，反之亦然。
      const [balance, queue] = await Promise.allSettled([this.gateway.status(key), this.gateway.queue(key)])
      const current = this.repository.list().find((account) => account.id === original.id)
      // 查询期间 Key 被替换或账号被删除时，旧响应不得覆盖新配置。
      if (current?.fingerprint !== original.fingerprint) return
      const now = new Date().toISOString()
      this.repository.save({ ...current,
        ...(balance.status === 'fulfilled'
          ? { balance: balance.value, status: 'ready' as const, checkedAt: now, error: '' }
          : { status: 'error' as const, error: '额度同步失败，请核对 Key、账号权限或网络' }),
        ...(queue.status === 'fulfilled'
          ? { queue: queue.value, concurrency: queue.value.concurrentLimit, queueStatus: 'ready' as const, queueCheckedAt: now, queueError: '' }
          : { queueStatus: 'error' as const, queueError: '队列同步失败，请核对 Key、账号权限或网络' })
      })
    } catch {
      const current = this.repository.list().find((account) => account.id === original.id)
      if (current?.fingerprint === original.fingerprint) this.repository.save({ ...current, status: 'error', error: '同步失败，请核对 Key、账号权限或网络',
        queueStatus: 'error', queueError: '队列同步失败，请核对 Key、账号权限或网络' })
    }
  }
}
