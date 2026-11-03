import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExtensionSettingValue, InstalledExtension, SpeechCapability } from '@contracts/extensions'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function useExtensions() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['extensions'], queryFn: async () => unwrap(await desktop().listExtensions()), retry: false, refetchInterval: 3000 })
  function update(extensions: InstalledExtension[]) {
    client.setQueryData(['extensions'], extensions)
    // 先同步撤销被卸载的贡献，再查询可用状态；不能等下一次轮询才隐藏入口。
    const installed = new Set(extensions.map((extension) => extension.id))
    client.setQueryData<SpeechCapability[]>(['production-capabilities'], (current) => current?.filter((item) => installed.has(item.extensionId)))
    void client.invalidateQueries({ queryKey: ['production-capabilities'] })
    return extensions
  }
  async function invalidateVoices(id: string) { await client.resetQueries({ queryKey: ['extension-voices', id] }) }
  return { ...query,
    install: async () => update(unwrap(await desktop().installExtension())),
    enable: async (id: string, enabled: boolean) => {
      const result = update(unwrap(await desktop().setExtensionEnabled(id, enabled)))
      await invalidateVoices(id)
      return result
    },
    remove: async (id: string) => {
      const result = update(unwrap(await desktop().removeExtension(id)))
      await invalidateVoices(id)
      return result
    },
    saveConfiguration: async (id: string, values: Record<string, ExtensionSettingValue>, secrets: Record<string, string>) => {
      // 密钥只作为专用 IPC 的瞬时参数，不进入 Query 的 key、data 或 mutation cache。
      update(unwrap(await desktop().saveExtensionSettings({ id, values })))
      for (const [key, value] of Object.entries(secrets)) {
        if (value) update(unwrap(await desktop().saveExtensionSecret({ id, key, value })))
      }
      await invalidateVoices(id)
    },
    clearSecret: async (id: string, key: string) => {
      update(unwrap(await desktop().saveExtensionSecret({ id, key, value: '' })))
      await invalidateVoices(id)
    },
    command: async (id: string, command: string) => {
      try { return unwrap(await desktop().runExtensionCommand(id, command)) }
      finally { await query.refetch() }
    }
  }
}

export function useExtensionVoices(id: string, providerId: string) {
  return useQuery({ queryKey: ['extension-voices', id, providerId],
    queryFn: async () => unwrap(await desktop().listExtensionVoices(id, providerId)), enabled: false, retry: false })
}
