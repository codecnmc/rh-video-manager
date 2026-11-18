import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { GenerationSourcesService, SqliteGenerationSources } from '../src/main/modules/generation-sources/index.ts'
import { comfyAddressSchema } from '../src/shared/contracts/generation-sources.ts'
import { parseComfyGraph } from '../src/main/providers/comfyui/client.ts'

function setup() {
  const database = new DatabaseSync(':memory:')
  const repository = new SqliteGenerationSources(database)
  let busy = false
  const service = new GenerationSourcesService(repository, { async inspect() { return { http: true, websocket: true, missingNodes: [], message: '已连接' } } }, () => {}, () => busy)
  const source = { id: randomUUID(), name: '本地 H3', address: 'http://127.0.0.1:8188', enabled: true, workflow: '{"1":{"class_type":"MiniMaxH3ReferenceToVideo","inputs":{}}}' }
  return { database, service, source, setBusy: () => { busy = true } }
}

test('无规则默认 RH；显式来源覆盖规则；第一条匹配规则生效', () => {
  const { database, service, source } = setup()
  try {
    assert.deepEqual(service.resolve('480P'), { kind: 'rh' })
    service.save({ revision: 0, sources: [source], rules: [
      { id: randomUUID(), name: '480P 本地', enabled: true, resolution: '480P', target: { kind: 'comfyui', sourceId: source.id } },
      { id: randomUUID(), name: '其余 RH', enabled: true, resolution: 'all', target: { kind: 'rh' } }
    ] })
    assert.deepEqual(service.resolve('480P'), { kind: 'comfyui', sourceId: source.id, workflowId: source.id })
    assert.deepEqual(service.resolve('720P'), { kind: 'rh' })
    assert.deepEqual(service.resolve('480P', { kind: 'rh' }), { kind: 'rh' })
    assert.deepEqual(service.resolve('1080P', { kind: 'comfyui', sourceId: source.id }), { kind: 'comfyui', sourceId: source.id, workflowId: source.id })
  } finally { database.close() }
})

test('配置修订拒绝覆盖；有任务时不能改来源地址或移除来源', () => {
  const { database, service, source, setBusy } = setup()
  try {
    const saved = service.save({ revision: 0, sources: [source], rules: [] })
    assert.throws(() => service.save({ ...saved, revision: 0 }), /已变化/)
    setBusy()
    assert.throws(() => service.save({ ...saved, sources: [] }), /未结束任务/)
    assert.throws(() => service.save({ ...saved, sources: [{ ...source, address: 'http://127.0.0.1:8189' }] }), /未结束任务/)
  } finally { database.close() }
})

test('显式来源停用或丢失时拒绝提交，不回退到 RH', () => {
  const { database, service, source } = setup()
  try {
    service.save({ revision: 0, sources: [{ ...source, enabled: false }], rules: [] })
    assert.throws(() => service.resolve('480P', { kind: 'comfyui', sourceId: source.id }), /停用/)
    assert.throws(() => service.resolve('480P', { kind: 'comfyui', sourceId: randomUUID() }), /不存在/)
  } finally { database.close() }
})

test('地址保留反向代理路径，拒绝 URL 内嵌凭据及非服务协议', () => {
  assert.equal(comfyAddressSchema.parse('http://127.0.0.1:8188/comfy/'), 'http://127.0.0.1:8188/comfy')
  for (const address of ['file:///tmp', 'http://user:secret@localhost:8188', 'http://localhost:8188?token=secret', 'http://localhost:8188/#fragment']) assert.equal(comfyAddressSchema.safeParse(address).success, false)
})

test('一个连接保留多个视频及声音工作流，视频路由不能误选声音工作流', () => {
  const { database, service, source } = setup()
  const videoId = randomUUID()
  const audioId = randomUUID()
  try {
    service.save({ revision: 0, sources: [{ ...source, workflow: undefined, workflows: [
      { id: videoId, name: '视频', kind: 'video', enabled: true, workflow: source.workflow },
      { id: audioId, name: '声音克隆', kind: 'audio', purpose: 'voice-clone', enabled: true, workflow: source.workflow }
    ] }], rules: [] })
    assert.equal(service.get(source.id).workflows?.length, 2)
    assert.equal(service.listWorkflows().find((item) => item.id === audioId)?.kind, 'audio')
    assert.deepEqual(service.resolve('480P', { kind: 'comfyui', sourceId: source.id, workflowId: videoId }), { kind: 'comfyui', sourceId: source.id, workflowId: videoId })
    assert.throws(() => service.resolve('480P', { kind: 'comfyui', sourceId: source.id, workflowId: audioId }), /视频工作流/)
  } finally { database.close() }
})

test('连接检测仅依赖地址，连接可以不导入工作流先保存', async () => {
  const { database, service, source } = setup()
  try {
    const result = await service.inspect({ address: source.address })
    assert.equal(result.http, true)
    const saved = service.save({ revision: 0, sources: [{ id: source.id, name: source.name, address: source.address, enabled: true, workflows: [] }], rules: [] })
    assert.deepEqual(saved.sources[0]?.workflows, [])
    assert.throws(() => service.save({ ...saved, sources: [{ ...saved.sources[0], name: '' }] }), /连接.*名称/)
  } finally { database.close() }
})

test('画布 JSON 与 API 节点格式错误有明确提示，不返回笼统输入错误', () => {
  assert.throws(() => parseComfyGraph('{"nodes":[],"links":[]}'), /画布格式.*API/)
  assert.throws(() => parseComfyGraph('not json'), /有效 JSON/)
  assert.throws(() => parseComfyGraph('{"42":{"inputs":{}}}'), /42.class_type/)
})

test('声音工作流检测后共享表单与应用配置，修改地址使检测失效', async () => {
  const database = new DatabaseSync(':memory:')
  const repository = new SqliteGenerationSources(database)
  const id = randomUUID()
  const workflowId = randomUUID()
  const form = { fields: [{ key: 'input-text', title: '音色描述', type: 'text' as const, defaultValue: '温暖' }], inspectedAt: new Date().toISOString() }
  const service = new GenerationSourcesService(repository, { async inspect() { return { http: true, websocket: true, missingNodes: [], message: '连接成功' } } }, () => {}, () => false, async () => form)
  try {
    service.save({ revision: 0, sources: [{ id, name: '内网', address: 'http://127.0.0.1:8188', enabled: true, workflows: [{ id: workflowId, name: '音色设计', kind: 'audio', purpose: 'voice-design', enabled: true, workflow: '{"1":{"class_type":"DesignVoice","inputs":{}}}' }] }], rules: [] })
    await service.inspectWorkflow(workflowId)
    const workflow = service.listWorkflows()[0]!
    assert.deepEqual(workflow.form, form)
    assert.equal(workflow.provider, 'comfyui')
    assert.equal(workflow.application?.fields[0]?.key, 'input-text')
    service.saveApplication({ id: workflowId, expectedCheckedAt: workflow.checkedAt!, expectedUpdatedAt: workflow.application?.updatedAt ?? null, fields: workflow.application!.fields })
    const settings = service.list()
    settings.sources[0]!.address = 'http://127.0.0.1:8190'
    service.save(settings)
    assert.equal(service.listWorkflows()[0]?.checkedAt, null)
    assert.equal(service.listWorkflows()[0]?.form, null)
  } finally { database.close() }
})
