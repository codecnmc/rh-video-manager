import { z } from 'zod'
import { routingSettingsSchema, comfyAddressSchema, type GenerationTarget, type RoutingSettings } from '../../../../shared/contracts/generation-sources'
import { suggestWorkflowApplication, reconcileWorkflowApplication } from '../../workflows'
import { saveWorkflowApplicationSchema, type Workflow, type WorkflowFormDefinition, type SaveWorkflowApplication } from '../../../../shared/contracts/workflows'
import type { GenerationSourcesRepository, SourceInspector } from '../ports/sources'

export class GenerationSourcesService {
  constructor(private readonly repository: GenerationSourcesRepository, private readonly inspector: SourceInspector,
    private readonly validateWorkflow: (workflow: string) => void, private readonly inUse: (id: string) => boolean,
    private readonly inspectDefinition?: (address: string, graph: string, kind: 'video' | 'audio') => Promise<WorkflowFormDefinition | null>) {}
  list(): RoutingSettings {
    const settings = this.repository.load()
    // 旧单工作流记录按原 ID 映射，历史任务和草稿引用不变；读操作不隐式写库。
    return { ...settings, sources: settings.sources.map((source) => ({ ...source,
      workflows: source.workflows ?? (source.workflow && source.workflow !== '{}' ? [{ id: source.id, name: source.name, kind: 'video' as const, purpose: 'video' as const, enabled: true, workflow: source.workflow }] : []) })) }
  }
  get(id: string) {
    const source = this.list().sources.find((item) => item.id === id)
    if (!source) throw new Error('ComfyUI 来源不存在')
    return source
  }
  validateImport(json: string): string { this.validateWorkflow(json); return json }
  save(raw: unknown): RoutingSettings {
    const parsed = routingSettingsSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const labels: Record<string, string> = { sources: '连接', workflows: '工作流', rules: '规则', name: '名称', address: '服务地址', workflow: '工作流 JSON', kind: '类型', target: '目标', sourceId: '连接', workflowId: '工作流', resolution: '分辨率' }
      const field = issue?.path.map((part) => typeof part === 'number' ? `第 ${part + 1} 项` : labels[String(part)] ?? '配置').join(' · ')
      throw new Error(`${field || '配置'}：${issue?.message ?? '请检查此字段'}`)
    }
    const input = parsed.data
    if (new Set(input.sources.map((item) => item.id)).size !== input.sources.length || new Set(input.rules.map((item) => item.id)).size !== input.rules.length) throw new Error('来源或规则标识重复')
    const previous = this.list()
    for (const source of input.sources) {
      source.workflows ??= source.workflow && source.workflow !== '{}' ? [{ id: source.id, name: source.name, kind: 'video', enabled: true, workflow: source.workflow }] : []
      for (const workflow of source.workflows) {
        try { this.validateWorkflow(workflow.workflow) } catch (error) { throw new Error(`来源「${source.name}」的工作流「${workflow.name}」：${error instanceof Error ? error.message : '格式错误'}`) }
        const oldSource = previous.sources.find((entry) => entry.id === source.id)
        const old = oldSource?.workflows?.find((entry) => entry.id === workflow.id)
        const unchanged = oldSource?.address === source.address && old?.workflow === workflow.workflow && old?.kind === workflow.kind
        workflow.form = unchanged ? old?.form ?? null : null
        workflow.application = unchanged ? old?.application ?? null : null
        workflow.checkedAt = unchanged ? old?.checkedAt ?? null : null
        workflow.error = unchanged ? old?.error ?? '' : ''
      }
      delete source.workflow
    }
    const allIds = input.sources.flatMap((source) => (source.workflows ?? []).map((workflow) => workflow.id))
    if (new Set(allIds).size !== allIds.length) throw new Error('工作流标识重复')
    for (const old of this.list().sources) {
      const next = input.sources.find((item) => item.id === old.id)
      if (this.inUse(old.id) && (!next || next.address !== old.address || JSON.stringify(next.workflows?.map((item) => [item.id, item.workflow, item.kind])) !== JSON.stringify(old.workflows?.map((item) => [item.id, item.workflow, item.kind])))) throw new Error('来源仍有未结束任务，暂不能删除或修改地址及工作流')
    }
    for (const rule of input.rules) {
      const target = rule.target
      if (target.kind === 'comfyui' && !input.sources.some((item) => item.id === target.sourceId && (!rule.enabled || item.enabled))) throw new Error('规则引用了不存在或停用的 ComfyUI 来源')
      if (target.kind === 'comfyui' && rule.enabled) {
        try { this.videoWorkflow(target.sourceId, target.workflowId, input) }
        catch (error) { throw new Error(`规则「${rule.name}」：${error instanceof Error ? error.message : '请选择目标工作流'}`) }
      }
    }
    const saved = { ...input, revision: input.revision + 1 }
    this.repository.save(saved, input.revision)
    return saved
  }
  inspect(raw: unknown) {
    const parsed = z.object({ address: comfyAddressSchema }).safeParse(raw)
    if (!parsed.success) throw new Error(`服务地址：${parsed.error.issues[0]?.message ?? '请输入有效地址'}`)
    return this.inspector.inspect(parsed.data)
  }
  async hasRunningTasks(id: string): Promise<boolean | null> {
    const source = this.get(id)
    try { return await this.inspector.hasRunningTasks?.(source) ?? null }
    catch { return null }
  }
  findWorkflow(id: string) {
    for (const source of this.list().sources) {
      const workflow = source.workflows?.find((item) => item.id === id)
      if (workflow) return { source, workflow }
    }
    return undefined
  }
  videoWorkflow(sourceId: string, workflowId?: string, settings = this.list()) {
    const source = settings.sources.find((item) => item.id === sourceId)
    if (!source) throw new Error('ComfyUI 连接不存在')
    const candidates = (source.workflows ?? []).filter((item) => item.enabled && item.kind === 'video' && (!workflowId || item.id === workflowId))
    if (candidates.length !== 1) throw new Error('请为 ComfyUI 路由明确选择一个启用的视频工作流')
    return { source, workflow: candidates[0]! }
  }
  listWorkflows(): Workflow[] {
    return this.list().sources.flatMap((source) => (source.workflows ?? []).map((workflow) => ({
      id: workflow.id, accountId: source.id, workflowId: workflow.id, name: workflow.name, kind: workflow.kind,
      provider: 'comfyui' as const, sourceId: source.id, sourceName: source.name,
      enabled: source.enabled && workflow.enabled, isDefault: false, capabilities: null,
      checkedAt: workflow.checkedAt ?? null, error: workflow.error ?? '', form: workflow.form ?? null, application: workflow.application ?? null
    })))
  }
  async inspectWorkflow(id: string): Promise<void> {
    const found = this.findWorkflow(id)
    if (!found || !this.inspectDefinition) throw new Error('本地工作流不存在或检测未接入')
    const { source, workflow } = found
    let form: WorkflowFormDefinition | null
    try { form = await this.inspectDefinition(source.address, workflow.workflow, workflow.kind) }
    catch (error) {
      const message = error instanceof Error && /^(工作流|此视频|ComfyUI 接口|API 工作流|导入的是)/.test(error.message) ? error.message : '工作流检测失败，请检查连接地址、节点安装及服务状态'
      const current = this.list()
      const owner = current.sources.find((item) => item.id === source.id)
      const target = owner?.workflows?.find((item) => item.id === id)
      if (owner?.address === source.address && target?.workflow === workflow.workflow) {
        target.error = message; target.checkedAt = null
        this.repository.save({ ...current, revision: current.revision + 1 }, current.revision)
      }
      throw new Error(message)
    }
    const current = this.list()
    const owner = current.sources.find((item) => item.id === source.id)
    const target = owner?.workflows?.find((item) => item.id === id)
    if (!owner || owner.address !== source.address || !target || target.workflow !== workflow.workflow || target.kind !== workflow.kind) throw new Error('检测期间工作流已变化，请重试')
    const changed = JSON.stringify(target.form?.fields) !== JSON.stringify(form?.fields)
    target.application = !form ? null : changed && target.form ? reconcileWorkflowApplication(form, target.application, target.form) : target.application ?? suggestWorkflowApplication(form)
    target.form = form; target.checkedAt = new Date().toISOString(); target.error = ''
    this.repository.save({ ...current, revision: current.revision + 1 }, current.revision)
  }
  saveApplication(raw: SaveWorkflowApplication): void {
    const input = saveWorkflowApplicationSchema.parse(raw)
    const settings = this.list()
    const target = settings.sources.flatMap((source) => source.workflows ?? []).find((item) => item.id === input.id)
    if (!target?.form || target.kind !== 'audio' || target.checkedAt !== input.expectedCheckedAt || (target.application?.updatedAt ?? null) !== input.expectedUpdatedAt) throw new Error('工作流配置已变化，请重新打开')
    if (input.fields.length !== target.form.fields.length || new Set(input.fields.map((field) => field.key)).size !== input.fields.length) throw new Error('请配置全部字段且不要重复')
    for (const field of target.form.fields) {
      const configured = input.fields.find((item) => item.key === field.key)
      if (!configured || typeof configured.defaultValue !== typeof field.defaultValue || field.type !== 'text' && configured.control !== 'native' || field.type === 'text' && configured.control === 'native' || (field.type === 'audio' || field.type === 'image') && configured.visibility === 'fixed') throw new Error(`输入字段「${field.title}」配置不正确`)
    }
    target.application = { fields: input.fields, needsReview: false, updatedAt: new Date(Math.max(Date.now(), Date.parse(target.application?.updatedAt ?? '') + 1 || 0)).toISOString() }
    this.repository.save({ ...settings, revision: settings.revision + 1 }, settings.revision)
  }
  removeWorkflow(id: string): void {
    const found = this.findWorkflow(id)
    if (!found) throw new Error('本地工作流不存在')
    const settings = this.list()
    const source = settings.sources.find((item) => item.id === found.source.id)!
    source.workflows = (source.workflows ?? []).filter((item) => item.id !== id)
    settings.rules = settings.rules.filter((rule) => rule.target.kind !== 'comfyui' || rule.target.workflowId !== id)
    this.save(settings)
  }
  resolve(resolution: string, explicit?: GenerationTarget): GenerationTarget {
    const target = explicit ?? this.list().rules.find((rule) => rule.enabled && (rule.resolution === 'all' || rule.resolution === resolution))?.target ?? { kind: 'rh' as const }
    if (target.kind === 'comfyui' && !this.get(target.sourceId).enabled) throw new Error('指定的 ComfyUI 来源已停用')
    if (target.kind === 'comfyui') {
      const selected = this.videoWorkflow(target.sourceId, target.workflowId)
      return { kind: 'comfyui', sourceId: target.sourceId, workflowId: selected.workflow.id }
    }
    return target
  }
}
