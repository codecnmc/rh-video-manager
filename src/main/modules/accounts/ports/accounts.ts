import type { Account, AccountBalance, AccountQueue } from '../../../../shared/contracts/accounts'

export interface AccountRecord extends Account { cipher: Uint8Array; fingerprint: string }
export interface AccountRepository {
  list(): AccountRecord[]
  save(account: AccountRecord): void
  remove(id: string): void
}
export interface CredentialVault {
  seal(key: string): { cipher: Uint8Array; fingerprint: string; keyHint: string }
  open(cipher: Uint8Array): string
}
export interface AccountGateway {
  status(key: string): Promise<AccountBalance>
  queue(key: string): Promise<AccountQueue>
}
