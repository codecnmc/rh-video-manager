import { utilityProcess, shell, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { ExtensionHost, ExtensionRecord } from '../../modules/extensions'
import { hostResponseSchema, hostStorageRequestSchema, hostOpenStorageRequestSchema, type HostRequest } from './host-protocol'
import { ExtensionStorageSession } from './storage'
import type { SpeechSynthesisRequest, ExtensionDocumentContext, ExtensionPageContext } from '../../../shared/contracts/extensions'

interface Session {
  child: UtilityProcess
  storage: ExtensionStorageSession
  storagePath: string
  status: 'activating' | 'active' | 'error'
  error: string | null
  pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
}

export class UtilityExtensionHost implements ExtensionHost {
  private readonly sessions = new Map<string, Session>()
  constructor(private readonly entry: string, private readonly packagesDirectory: string) {}
  state(id: string) {
    const session = this.sessions.get(id)
    return session ? { status: session.status, error: session.error } : { status: 'idle' as const, error: null }
  }
  private settle(session: Session, message: unknown): void {
    const openRequest = hostOpenStorageRequestSchema.safeParse(message)
    if (openRequest.success) {
      if (session.status !== 'active' || ![...this.sessions.values()].includes(session)) return
      const requestId = openRequest.data.requestId
      // 固定打开本会话的输出目录，不接受插件提供的路径、URL 或 shell 命令。
      void mkdir(session.storagePath, { recursive: true }).then(() => shell.openPath(session.storagePath)).then((error) => {
        if (session.status === 'active' && [...this.sessions.values()].includes(session)) {
          session.child.postMessage({ kind: 'storage-result', requestId, ok: error === '', value: null })
        }
      }).catch(() => {
        if (session.status === 'active' && [...this.sessions.values()].includes(session)) {
          try { session.child.postMessage({ kind: 'storage-result', requestId, ok: false }) } catch { /* 宿主可能已退出。 */ }
        }
      })
      return
    }
    const storageRequest = hostStorageRequestSchema.safeParse(message)
    if (storageRequest.success) {
      if (session.status === 'error' || ![...this.sessions.values()].includes(session)) return
      const { requestId, input } = storageRequest.data
      // 身份由消息所属会话决定，协议不允许指定插件 ID、本体表或数据库路径。
      try {
        const value = session.storage.execute(input)
        session.child.postMessage({ kind: 'storage-result', requestId, ok: true, value })
      } catch {
        try { session.child.postMessage({ kind: 'storage-result', requestId, ok: false }) }
        catch { this.fail(session, '插件存储响应发送失败'); session.child.kill() }
      }
      return
    }
    const parsed = hostResponseSchema.safeParse(message)
    if (!parsed.success) return
    const pending = session.pending.get(parsed.data.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    session.pending.delete(parsed.data.requestId)
    if (parsed.data.ok) pending.resolve(parsed.data.value)
    else pending.reject(new Error('插件操作失败，请检查插件配置与本地模型服务'))
  }
  private fail(session: Session, message: string): void {
    session.status = 'error'; session.error = message
    session.storage.close()
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    session.pending.clear()
  }
  private request(session: Session, request: HostRequest, timeout = 30000, waitForSpawn = false): Promise<unknown> {
    if (session.status === 'error') return Promise.reject(new Error(session.error ?? '插件进程异常'))
    if (session.pending.size) return Promise.reject(new Error('插件正在处理其他操作，请稍后再试'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(session, '插件响应超时，已停止宿主；未自动重试，外部服务结果需单独确认')
        session.child.kill()
      }, timeout)
      session.pending.set(request.requestId, { resolve, reject, timer })
      const send = () => {
        if (!session.pending.has(request.requestId)) return
        try { session.child.postMessage(request) }
        catch { this.fail(session, '无法发送插件请求'); session.child.kill() }
      }
      if (waitForSpawn) session.child.once('spawn', send)
      else send()
    })
  }
  async start(record: ExtensionRecord, secrets: Record<string, string>): Promise<void> {
    this.stop(record.id)
    const storagePath = join(this.packagesDirectory, '..', 'extension-data', record.id)
    await mkdir(storagePath, { recursive: true })
    // 只传递运行环境必需变量，不继承宿主的 API Key 等自定义环境变量。
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
      .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
    // 初始化失败不启动代码；数据库由主进程持有，不传入宿主路径或连接。
    const storage = await ExtensionStorageSession.open(join(this.packagesDirectory, '..', 'extension-databases'), record.id, record.manifest.storage)
    let child: UtilityProcess
    try { child = utilityProcess.fork(this.entry, [], { env, stdio: 'ignore', serviceName: `插件 ${record.id}` }) }
    catch (error) { storage.close(); throw error }
    const session: Session = { child, storage, storagePath, status: 'activating', error: null, pending: new Map() }
    this.sessions.set(record.id, session)
    child.on('message', (message: unknown) => this.settle(session, message))
    child.on('error', () => { this.fail(session, '插件进程发生异常'); child.kill() })
    child.on('exit', () => {
      if (this.sessions.get(record.id) === session && session.status !== 'error') this.fail(session, '插件进程已退出，未自动重启')
    })
    try {
      await this.request(session, { requestId: randomUUID(), method: 'activate',
        entry: join(this.packagesDirectory, record.packageKey, record.manifest.main.slice(2)),
        storagePath, manifest: record.manifest, settings: record.settings, secrets }, 15000, true)
      if (this.sessions.get(record.id) !== session || session.status === 'error') throw new Error('插件激活已取消')
      session.status = 'active'
    } catch {
      this.fail(session, '插件激活失败，请检查配置、入口或模型服务；未自动重试')
      child.kill()
      throw new Error(session.error!)
    }
  }
  async command(id: string, command: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'active') throw new Error('插件尚未激活')
    await this.request(session, { requestId: randomUUID(), method: 'command', id: command }, 120000)
  }
  async contextCommand(id: string, command: string, context: ExtensionDocumentContext): Promise<unknown> {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'active') throw new Error('插件尚未激活')
    return this.request(session, { requestId: randomUUID(), method: 'contextCommand', id: command, context }, 120000)
  }
  async voices(id: string, providerId: string): Promise<unknown> {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'active') throw new Error('插件尚未激活')
    return this.request(session, { requestId: randomUUID(), method: 'voices', id: providerId })
  }
  async page(id: string, pageId: string, context: ExtensionPageContext): Promise<unknown> {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'active') throw new Error('插件尚未激活')
    return this.request(session, { requestId: randomUUID(), method: 'page', id: pageId, context }, 120000)
  }
  async synthesize(id: string, providerId: string, input: SpeechSynthesisRequest, signal: AbortSignal): Promise<unknown> {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'active') throw new Error('插件尚未激活')
    if (signal.aborted) throw new Error('生成已取消')
    // 取消仅停止本地宿主；云端是否受理、计费或终止不能由此推断。
    const abort = () => this.stop(id)
    signal.addEventListener('abort', abort, { once: true })
    try { return await this.request(session, { requestId: randomUUID(), method: 'synthesize', id: providerId, input }, 120000) }
    finally { signal.removeEventListener('abort', abort) }
  }
  stop(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    this.fail(session, '插件已停用，进行中的请求已中断；外部操作不保证已取消')
    // 给 deactivate 一个短暂清理窗口，再终止宿主；不承诺终止插件派生的外部模型进程。
    try { session.child.postMessage({ requestId: randomUUID(), method: 'deactivate' }) } catch { /* 进程可能已退出。 */ }
    const timer = setTimeout(() => session.child.kill(), 500)
    timer.unref()
  }
  stopAll(): void { for (const id of this.sessions.keys()) this.stop(id) }
}
