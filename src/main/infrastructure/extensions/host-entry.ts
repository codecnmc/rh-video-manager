import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ExtensionContext, ExtensionModule, SpeechProvider, CommandHandler, PageHandler } from '../../../../sdk/extension-api'
import { extensionApiVersion, speechVoicesSchema, speechAudioSchema, extensionProposalSchema,
  extensionStorageOperationSchema, extensionStorageValueSchema, type ExtensionStorageOperation } from '../../../shared/contracts/extensions'
import { hostRequestSchema, hostStorageResponseSchema, type HostRequest } from './host-protocol'

const commands = new Map<string, CommandHandler>()
const pages = new Map<string, PageHandler>()
const providers = new Map<string, SpeechProvider>()
const controller = new AbortController()
let extension: ExtensionModule | undefined
let context: ExtensionContext | undefined
let busy = false
const storagePending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const storageEntrySchema = z.strictObject({ key: z.string().min(1).max(200), value: extensionStorageValueSchema })

function storageRequest(input?: ExtensionStorageOperation): Promise<unknown> {
  controller.signal.throwIfAborted()
  const parsed = input === undefined ? undefined : extensionStorageOperationSchema.parse(input)
  if (storagePending.size >= 32) return Promise.reject(new Error('Too many pending storage requests'))
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { storagePending.delete(requestId); reject(new Error('Storage request timed out')) }, 5000)
    storagePending.set(requestId, { resolve, reject, timer })
    try { process.parentPort.postMessage(parsed === undefined ? { kind: 'open-storage-directory', requestId } : { kind: 'storage', requestId, input: parsed }) }
    catch {
      clearTimeout(timer); storagePending.delete(requestId); reject(new Error('Storage unavailable'))
    }
  })
}

const moduleSchema = z.custom<ExtensionModule>((value: unknown) => typeof value === 'object' && value !== null &&
  'activate' in value && typeof value.activate === 'function' && (!('deactivate' in value) || typeof value.deactivate === 'function'))

async function handle(request: HostRequest): Promise<unknown> {
  if (request.method === 'deactivate') {
    controller.abort()
    for (const pending of storagePending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Storage session revoked')) }
    storagePending.clear()
    for (const disposable of [...(context?.subscriptions ?? [])].reverse()) await disposable.dispose()
    await extension?.deactivate?.()
    commands.clear(); providers.clear(); pages.clear()
    return null
  }
  if (request.method === 'activate') {
    if (extension) throw new Error('Already activated')
    const manifest = request.manifest
    extension = moduleSchema.parse(createRequire(request.entry)(request.entry))
    const secrets = Object.freeze({ ...request.secrets })
    context = {
      extensionId: `${manifest.publisher}.${manifest.name}`, apiVersion: extensionApiVersion, storagePath: request.storagePath,
      storage: Object.freeze({
        async get(table: string, key: string) { return storageEntrySchema.nullable().parse(await storageRequest({ operation: 'get', table, key })) },
        async set(table: string, key: string, value: z.infer<typeof extensionStorageValueSchema>) { await storageRequest({ operation: 'set', table, key, value }) },
        async delete(table: string, key: string) { await storageRequest({ operation: 'delete', table, key }) },
        async list(table: string, options?: { after?: string; limit?: number }) {
          return z.array(storageEntrySchema).max(100).parse(await storageRequest({ operation: 'list', table, limit: options?.limit ?? 100,
            ...(options?.after === undefined ? {} : { after: options.after }) }))
        }
      }),
      async openStorageDirectory() { await storageRequest() },
      configuration: Object.freeze({ ...request.settings }), secrets: { get: (key) => Object.hasOwn(secrets, key) ? secrets[key] : undefined }, subscriptions: [],
      registerCommand(id, handler) {
        if (!manifest.contributes.commands.some((item) => item.id === id) || commands.has(id) || typeof handler !== 'function') throw new Error('Undeclared command')
        commands.set(id, handler)
        return { dispose() { commands.delete(id) } }
      },
      registerPage(id, handler) {
        if (!manifest.contributes.pages?.some((page) => page.id === id) || pages.has(id) || typeof handler !== 'function') throw new Error('Undeclared page')
        pages.set(id, handler)
        return { dispose() { pages.delete(id) } }
      },
      registerSpeechProvider(id, provider) {
        const declared = manifest.contributes.speechProviders.find((item) => item.id === id)
        if (!declared || providers.has(id) || typeof provider?.listVoices !== 'function' || typeof provider.synthesize !== 'function' ||
          declared.capabilities.voiceCloning && typeof provider.cloneVoice !== 'function') throw new Error('Invalid speech provider')
        providers.set(id, provider)
        return { dispose() { providers.delete(id) } }
      }
    }
    await extension.activate(context)
    if (manifest.contributes.commands.some((item) => !commands.has(item.id)) ||
      manifest.contributes.speechProviders.some((item) => !providers.has(item.id)) ||
      manifest.contributes.pages?.some((item) => !pages.has(item.id))) throw new Error('Missing contribution')
    return null
  }
  if (!context) throw new Error('Not activated')
  if (request.method === 'page') {
    const page = pages.get(request.id)
    if (!page) throw new Error('Page not registered')
    return extensionProposalSchema.parse(await page(controller.signal, Object.freeze(request.context)))
  }
  if (request.method === 'command' || request.method === 'contextCommand') {
    const command = commands.get(request.id)
    if (!command) throw new Error('Command not registered')
    if (request.method === 'contextCommand') {
      return extensionProposalSchema.parse(await command(controller.signal, Object.freeze(request.context)) ?? null)
    }
    await command(controller.signal)
    // 命令返回值不穿透到界面，避免意外返回密钥或任意内部对象。
    return null
  }
  const provider = providers.get(request.id)
  if (!provider) throw new Error('Provider not registered')
  if (request.method === 'synthesize') return speechAudioSchema.parse(await provider.synthesize(request.input, controller.signal))
  return speechVoicesSchema.parse(await provider.listVoices(controller.signal))
}

process.parentPort.on('message', (event: { data: unknown }) => {
  // 存储响应必须先处理，不能被正在等待它的 activate/command 忙状态拦截。
  const storageResponse = hostStorageResponseSchema.safeParse(event.data)
  if (storageResponse.success) {
    const pending = storagePending.get(storageResponse.data.requestId)
    if (pending) {
      clearTimeout(pending.timer); storagePending.delete(storageResponse.data.requestId)
      if (storageResponse.data.ok) pending.resolve(storageResponse.data.value)
      else pending.reject(new Error('Storage operation denied or failed'))
    }
    return
  }
  const parsed = hostRequestSchema.safeParse(event.data)
  if (!parsed.success) return
  const request = parsed.data
  if (busy && request.method !== 'deactivate') {
    process.parentPort.postMessage({ requestId: request.requestId, ok: false })
    return
  }
  busy = true
  void handle(request).then((value) => {
    process.parentPort.postMessage({ requestId: request.requestId, ok: true, value })
  }).catch(() => {
    // 不记录、不转发插件抛出的原始异常，防止 URL、提示词或凭据外泄。
    process.parentPort.postMessage({ requestId: request.requestId, ok: false })
  }).finally(() => { busy = false })
})
