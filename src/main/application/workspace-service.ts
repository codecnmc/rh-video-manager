import { randomUUID } from 'node:crypto'
import { copyVideoDraftSchema, workspaceSchema, type CopyVideoDraft, type DeleteWorkspaceEntity, type SaveWorkspace, type Workspace } from '../../shared/contracts/workspace'
import type { WorkspaceRepository } from './workspace-repository'

export class WorkspaceService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly repository: WorkspaceRepository, private readonly seed: () => Workspace) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => undefined)
    return pending
  }

  load(): Promise<Workspace> {
    return this.serial(async () => {
      const existing = await this.repository.read()
      if (existing) return existing
      const initial = this.seed()
      await this.repository.write(initial)
      return initial
    })
  }

  save(input: SaveWorkspace, authorize: () => void = () => undefined): Promise<Workspace> {
    return this.serial(async () => {
      const existing = await this.repository.read()
      if (!existing || existing.revision !== input.expectedRevision) {
        throw new Error('草稿已在其他窗口更新，请重新载入后再编辑')
      }
      // 串行比较修订并写入，避免并发保存覆盖另一次更新。
      const next = workspaceSchema.parse({
        ...input.workspace, revision: existing.revision + 1, updatedAt: new Date().toISOString()
      })
      const ids = next.projects.flatMap((project) => [project.id, ...project.episodes.map((episode) => episode.id),
        ...project.videoDrafts.map((draft) => draft.id)])
      if (new Set(ids).size !== ids.length) throw new Error('项目、分集或视频草稿标识重复')
      for (const project of next.projects) {
        const groups = project.videoGroups ?? []
        const groupIds = new Set(groups.map((group) => group.id))
        if (groupIds.size !== groups.length) throw new Error('视频分组标识重复')
        if (new Set(groups.map((group) => group.name)).size !== groups.length) throw new Error('视频分组名称重复')
        if (project.videoDrafts.some((draft) => draft.groupId && !groupIds.has(draft.groupId))) throw new Error('视频草稿分组不属于当前项目')
      }
      for (const oldProject of existing.projects) {
        const project = next.projects.find((item) => item.id === oldProject.id)
        if (!project) throw new Error('请使用专用删除入口删除项目')
        if (oldProject.videoDrafts.some((draft) => !project.videoDrafts.some((item) => item.id === draft.id))) {
          throw new Error('请使用专用删除入口；视频草稿不能跨项目移动')
        }
        for (const oldEpisode of oldProject.episodes) {
          const episode = project.episodes.find((item) => item.id === oldEpisode.id)
          if (!episode) {
            throw new Error('请使用专用删除入口；分集不能跨项目移动')
          }
        }
      }
      authorize()
      await this.repository.write(next)
      return next
    })
  }

  remove(input: DeleteWorkspaceEntity): Promise<Workspace> {
    return this.serial(async () => {
      await this.repository.remove(input)
      const current = await this.repository.read()
      if (!current) throw new Error('项目数据不存在')
      return current
    })
  }

  copyVideoDraft(input: CopyVideoDraft): Promise<{ workspace: Workspace; draftId: string }> {
    input = copyVideoDraftSchema.parse(input)
    return this.serial(async () => {
      const current = await this.repository.read()
      if (!current || current.revision !== input.expectedRevision) throw new Error('草稿已更新，请重新载入后再复制')
      const project = current.projects.find((item) => item.id === input.projectId)
      const source = project?.videoDrafts.find((item) => item.id === input.draftId)
      if (!project || !source) throw new Error('待复制的视频草稿不存在')
      const draftId = randomUUID()
      const base = source.title.slice(0, 85).replace(/[\uD800-\uDBFF]$/, '')
      let suffix = 1
      let title = `${base} 副本`
      while (project.videoDrafts.some((item) => item.title === title)) title = `${base} 副本 ${++suffix}`
      const copied = { ...structuredClone(source), id: draftId, title }
      const workspace = workspaceSchema.parse({ ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(),
        projects: current.projects.map((item) => item.id === project.id ? { ...item,
          videoDrafts: item.videoDrafts.flatMap((draft) => draft.id === source.id ? [draft, copied] : [draft]) } : item) })
      // 草稿与原编号引用一起提交，复制不带入远端任务或触发付费生成。
      await this.repository.write(workspace, { sourceDraftId: source.id, targetDraftId: draftId, projectId: project.id })
      return { workspace, draftId }
    })
  }
}
