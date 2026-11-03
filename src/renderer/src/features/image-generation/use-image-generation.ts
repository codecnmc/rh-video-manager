import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateImageNode, ImageNode, SaveImageAccount, SaveImageNode, SaveImageLayout } from '@contracts/image-generation'
import { confirmAction } from '@/components/ui/confirmation'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { readPastedImages } from '@/shared/lib/read-pasted-images'
import { canRegenerateImageTask, imageRetryHasUnknownHistory } from './task-versions'
import type { ImageTaskFields } from './task-editor-state'

export function useImageGeneration(projectId: string | null, boardId: string | null, onNotice: (message: string) => void) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const acting = useRef(false)
  const [error, setError] = useState('')
  const [recoveringOutputId, setRecoveringOutputId] = useState<string | null>(null)
  const boards = useQuery({ queryKey: ['image-boards', projectId], queryFn: async () => unwrap(await desktop().imageBoards(projectId)), retry: false, refetchInterval: 2000, refetchIntervalInBackground: true })
  const accounts = useQuery({ queryKey: ['image-accounts'], queryFn: async () => unwrap(await desktop().imageAccounts()), retry: false, refetchInterval: 3000 })
  const settings = useQuery({ queryKey: ['image-settings'], queryFn: async () => unwrap(await desktop().imageExecutionSettings()), retry: false })
  const nodes = useQuery({ queryKey: ['image-nodes', boardId], queryFn: async () => boardId ? unwrap(await desktop().imageNodes(boardId)) : [], enabled: Boolean(boardId), retry: false, refetchInterval: 2000, refetchIntervalInBackground: true })
  const assets = useQuery({ queryKey: ['image-assets', projectId], queryFn: async () => {
    const results = await Promise.all([desktop().listAssets({ projectId, kind: 'image' }), ...(projectId ? [desktop().listAssets({ projectId: null, kind: 'image' })] : [])])
    return results.flatMap((result) => unwrap(result))
  }, retry: false, refetchInterval: 5000 })
  async function refresh() {
    await Promise.all(['image-boards', 'image-accounts', 'image-nodes', 'image-assets', 'image-settings', 'assets'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  }
  async function act<T>(action: () => Promise<T>, options: { quiet?: boolean; refresh?: boolean } = {}): Promise<T | undefined> {
    if (acting.current) return undefined
    acting.current = true
    if (!options.quiet) setBusy(true)
    setError('')
    try { const result = await action(); if (options.refresh !== false) await refresh(); return result }
    catch (failure) { const message = failure instanceof Error ? failure.message : '素材生成操作失败'; setError(message); onNotice(message); if (options.refresh !== false) await refresh(); return undefined }
    finally { acting.current = false; if (!options.quiet) setBusy(false) }
  }
  const action = (node: ImageNode) => ({ id: node.id, expectedRevision: node.revision })
  async function confirmSubmission(items: ImageNode[]) {
    const summary = items.map((node) => {
      const account = accounts.data?.find((item) => item.id === node.accountId)
      return `${node.title} · ${account?.name ?? '自动调度启用账号'} · ${account?.model ?? ''} · ${node.size} · 参考图 ${node.references.length} 张`
    }).join('\n')
    const retryRisk = items.some((node) => imageRetryHasUnknownHistory(node, nodes.data ?? []))
      ? '\n\n其中包含受理不明后解除占用的重试。解除占用不代表远端取消，重新生成可能重复扣费。' : ''
    return confirmAction(`确认向以下账号提交 ${items.length} 张图片？\n\n${summary}\n\n参考图片将外发给所选服务，费用以服务方计费为准，当前无法确认报价。每项只提交一次，失败不会自动重试。${retryRisk}`)
  }
  return { boards, accounts, nodes, assets, settings, busy, error, recoveringOutputId, refresh,
    deleteNodes: (items: ImageNode[]) => act(async () => {
      if (!boardId || !items.length) return false
      unwrap(await desktop().deleteImageNodes({ boardId, nodes: items.map(action) })); return true
    }),
    importImages: () => act(async () => unwrap(await desktop().importAssets({ projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }))),
    pasteImages: (files: File[]) => act(async () => unwrap(await desktop().pasteAssets({ projectId, categoryId: null, images: await readPastedImages(files) }))),
    saveConcurrency: (globalConcurrency: number) => act(async () => {
      if (!await confirmAction(`确认将生图全局并发改为 ${globalConcurrency}？提高上限会继续执行已确认的排队任务；此额度不包含软件外其他客户端的请求。`)) return false
      unwrap(await desktop().saveImageExecutionSettings({ globalConcurrency })); return true
    }),
    createBoard: (title: string) => act(async () => unwrap(await desktop().createImageBoard({ id: crypto.randomUUID(), projectId, title }))),
    saveNode: (input: CreateImageNode | SaveImageNode, automatic = false) => act(async () => {
      const saved = 'boardId' in input ? unwrap(await desktop().createImageNode(input)) : unwrap(await desktop().saveImageNode(input))
      // 保存响应即为新快照，不为一次草稿写入刷新账号、素材与整个工作区。
      const queryKey = ['image-nodes', saved.boardId]
      await client.cancelQueries({ queryKey, exact: true })
      client.setQueryData<ImageNode[]>(queryKey, (previous) => {
        if (!previous) return [saved]
        const existing = previous.find((node) => node.id === saved.id)
        if (existing && existing.revision > saved.revision) return previous
        return existing ? previous.map((node) => node.id === saved.id ? saved : node) : [...previous, saved]
      })
      return saved
    }, { quiet: automatic, refresh: false }),
    saveAccount: (input: SaveImageAccount) => act(async () => {
      // 不使用 mutation 缓存，密钥只从表单经专用 IPC 传入主进程。
      unwrap(await desktop().saveImageAccount(input)); return true
    }),
    saveLayout: (input: SaveImageLayout) => act(async () => unwrap(await desktop().saveImageLayout(input))),
    submit: (items: ImageNode[]) => act(async () => {
      if (!items.length) return false
      if (!await confirmSubmission(items)) return false
      unwrap(await desktop().submitImageNodes({ nodes: items.map(action), confirmed: true })); return true
    }),
    regenerate: (node: ImageNode, fields: ImageTaskFields) => act(async () => {
      if (!canRegenerateImageTask(node)) throw new Error('任务仍在途或受理不明，不能重新生成')
      const candidate = { ...node, ...fields, id: crypto.randomUUID(), sourceNodeId: node.id }
      // 先确认费用，再创建独立请求；取消不会留下空草稿，旧快照和图片不变。
      if (!await confirmSubmission([candidate])) return undefined
      const saved = unwrap(await desktop().createImageNode({ ...fields, id: candidate.id, boardId: node.boardId, sourceNodeId: node.id }))
      const queued = unwrap(await desktop().submitImageNodes({ nodes: [action(saved)], confirmed: true }))
      return queued[0]
    }),
    cancelQueued: (node: ImageNode) => act(async () => unwrap(await desktop().cancelQueuedImage(action(node)))),
    retryOutput: (node: ImageNode) => act(async () => {
      setRecoveringOutputId(node.id)
      try {
        unwrap(await desktop().retryImageOutput(action(node)))
        onNotice('已开始后台恢复下载，可切换页面；完成或失败请查看任务状态，未重新生图')
        return true
      } finally { setRecoveringOutputId(null) }
    }),
    resolveUnknown: (node: ImageNode) => act(async () => {
      if (!await confirmAction('请先在原服务核实请求已结束，再解除本地占用。解除占用不代表远端取消，也不保证退款。解除后可创建新任务重新生成；原请求若仍在执行，可能重复扣费。你已核实并确认解除占用？')) return false
      unwrap(await desktop().resolveUnknownImage({ ...action(node), confirmed: true })); return true
    }),
    resumeAccount: (id: string) => act(async () => {
      if (!await confirmAction('请先核实原服务的凭据、额度及限流已恢复。恢复此实际账号组后，已确认的排队任务将继续提交；受理不明任务仍保留占用。确认恢复？')) return false
      unwrap(await desktop().resumeImageAccount(id, true)); return true
    })
  }
}

export type ImageGenerationController = ReturnType<typeof useImageGeneration>
