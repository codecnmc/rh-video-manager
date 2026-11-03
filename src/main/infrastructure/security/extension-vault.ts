import { safeStorage } from 'electron'
import type { ExtensionVault } from '../../modules/extensions'

export class SafeStorageExtensionVault implements ExtensionVault {
  encrypt(value: string): Uint8Array {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存插件密钥')
    return safeStorage.encryptString(value)
  }
  decrypt(cipher: Uint8Array): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据解密不可用')
    try { return safeStorage.decryptString(Buffer.from(cipher)) }
    catch { throw new Error('无法解密插件凭据，请重新录入') }
  }
}
