import { randomUUID } from 'node:crypto'
import { mcpSaveDraftSchema, mcpSaveVideoGroupSchema, type McpSaveDraft, type McpSaveVideoGroup } from '../../shared/contracts/mcp-video'
import type { WorkspaceService } from './workspace-service'
import type { ReferenceService } from '../modules/assets'
import type { ReplaceDraftReference } from '../../shared/contracts/references'

export class WorkspaceDraftService {
  constructor(private readonly workspace: WorkspaceService, private readonly references: ReferenceService) {}

  async list(projectId: string) {
    const current = await this.workspace.load()
    const project = current.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('项目不存在或已删除')
    return { revision: current.revision, groups: project.videoGroups ?? [], drafts: project.videoDrafts.map((draft) => ({ ...draft, references: this.references.list(draft.id) })) }
  }

  async listGroups(projectId: string) {
    const current = await this.workspace.load()
    const project = current.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('项目不存在或已删除')
    return { revision: current.revision, groups: project.videoGroups ?? [] }
  }

  async saveGroup(raw: McpSaveVideoGroup, authorize: () => void) {
    const input = mcpSaveVideoGroupSchema.parse(raw)
    const current = await this.workspace.load()
    const project = current.projects.find((item) => item.id === input.projectId)
    if (!project) throw new Error('项目不存在或已删除')
    const groups = project.videoGroups ?? []
    if (input.id !== null && !groups.some((group) => group.id === input.id)) throw new Error('视频分组不属于当前项目')
    const group = { id: input.id ?? randomUUID(), name: input.name }
    // 只修改目标分组，保留其他分组及全部草稿；统一保存校验重名、数量和修订。
    const saved = await this.workspace.save({ expectedRevision: input.expectedRevision, workspace: {
      ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item,
        videoGroups: input.id === null ? [...groups, group] : groups.map((entry) => entry.id === group.id ? group : entry) })
    } }, authorize)
    return { revision: saved.revision, group }
  }

  async save(raw: McpSaveDraft, authorize: () => void) {
    const input = mcpSaveDraftSchema.parse(raw)
    const current = await this.workspace.load()
    const project = current.projects.find((item) => item.id === input.projectId)
    if (!project) throw new Error('项目不存在或已删除')
    const existing = input.draft.id === null ? undefined : project.videoDrafts.find((draft) => draft.id === input.draft.id)
    if (input.draft.id !== null && !existing) throw new Error('视频草稿不存在或已删除')
    // MCP 只编辑纯提示词；清空旧富文本，避免编辑器优先加载旧文档覆盖新提示词。
    const draft = { ...existing, ...input.draft, id: input.draft.id ?? randomUUID(), promptDocument: '',
      shotContinuity: input.draft.shotContinuity ?? existing?.shotContinuity ?? 'independent',
      nextTransition: input.draft.nextTransition ?? existing?.nextTransition ?? 'cut',
      continuityTailSeconds: input.draft.continuityTailSeconds ?? existing?.continuityTailSeconds ?? 1 }
    const saved = await this.workspace.save({ expectedRevision: input.expectedRevision, workspace: {
      ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item,
        videoDrafts: existing ? item.videoDrafts.map((entry) => entry.id === draft.id ? draft : entry) : [...item.videoDrafts, draft] })
    } }, authorize)
    return { revision: saved.revision, draft, references: this.references.list(draft.id) }
  }

  private async requireDraft(projectId: string, draftId: string) {
    const current = await this.workspace.load()
    if (!current.projects.some((project) => project.id === projectId && project.videoDrafts.some((draft) => draft.id === draftId))) {
      throw new Error('视频草稿不存在或已删除')
    }
  }

  async attach(projectId: string, draftId: string, assetId: string, authorize: () => void) {
    await this.requireDraft(projectId, draftId)
    authorize()
    return this.references.attach(draftId, projectId, assetId)
  }

  async detach(projectId: string, draftId: string, referenceId: string, authorize: () => void) {
    await this.requireDraft(projectId, draftId)
    if (!this.references.list(draftId).some((item) => item.id === referenceId)) throw new Error('素材引用不属于当前草稿')
    authorize()
    this.references.detach(referenceId)
    return this.references.list(draftId)
  }
  async replaceReference(projectId: string, input: ReplaceDraftReference, authorize: () => void) {
    await this.requireDraft(projectId, input.draftId)
    authorize()
    return this.references.replace(input, projectId)
  }
}
