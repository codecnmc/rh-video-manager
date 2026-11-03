import { createHash } from 'node:crypto'
import { safeStorage } from 'electron'
import type { CredentialVault } from '../../modules/accounts'

export class SafeStorageCredentialVault implements CredentialVault {
  seal(key: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存 API Key')
    return { cipher: safeStorage.encryptString(key), fingerprint: createHash('sha256').update(key).digest('hex'), keyHint: `••••${key.slice(-4)}` }
  }
  open(cipher: Uint8Array): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据解密不可用')
    try { return safeStorage.decryptString(Buffer.from(cipher)) }
    catch { throw new Error('无法解密账号凭据，请在原系统使用或重新填写 Key') }
  }
}
