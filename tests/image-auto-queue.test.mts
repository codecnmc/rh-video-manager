import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ImageGenerationService, ImageHttpError } from '../src/main/modules/image-generation/application/image-generation-service.ts'
import { SqliteImageGenerationRepository } from '../src/main/modules/image-generation/adapters/sqlite-image-generation-repository.ts'
import { imageAccountSchema, type ImageNode } from '../src/shared/contracts/image-generation.ts'
import { startAssetMcpSchema, assetMcpPreferencesSchema } from '../src/shared/contracts/mcp.ts'
import type { ImageOutput } from '../src/main/modules/image-generation/ports/image-generation.ts'

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.fail('队列没有进入预期状态')
}

function setup(groups = ['A', 'B'], beforeSend?: () => Promise<void>) {
  const database = new DatabaseSync(':memory:')
  database.exec('CREATE TABLE workspace_trash (id TEXT PRIMARY KEY)')
  const repository = new SqliteImageGenerationRepository(database)
  const accounts = groups.map((group) => imageAccountSchema.parse({ id: randomUUID(), revision: 1, name: group,
    baseUrl: 'https://provider.example.com', model: 'model', accountGroup: group, maxConcurrency: 1, enabled: true, stopped: false }))
  for (const account of accounts) repository.saveAccount({ account, cipher: new Uint8Array([1]), fingerprint: account.id }, 0)
  const calls: { accountId: string; node: ImageNode; complete: (output: ImageOutput) => void; fail: (error: Error) => void }[] = []
  const service = new ImageGenerationService(repository, {
    get() { throw new Error('无参考图') }, path() { throw new Error('无参考图') },
    register: (node) => node.id, async assertProject() {}
  }, { seal: (value) => ({ cipher: Buffer.from(value), fingerprint: 'test' }),
    open: (cipher) => cipher.length === 1 ? 'test-key' : Buffer.from(cipher).toString() }, {
    validate(_account, node) { if (node?.size === '1024x1024') throw new Error('此模型不支持方图') },
    async generate(account, _key, node, _paths, _signal, sending) {
      await beforeSend?.()
      sending()
      return new Promise<ImageOutput>((complete, fail) => calls.push({ accountId: account.id, node, complete, fail }))
    },
    async saveOutput(id) { return { storedName: `${id}.png`, size: 8 } },
    async diagnoseOutput() { return { kind: 'inline', downloadOrigin: null, sameServiceOrigin: false, network: 'not_needed', fakeIpAllowed: false } }
  }, randomUUID)
  return { database, repository, accounts, calls, service, async close() {
    service.stop()
    for (const call of calls) call.fail(new Error('测试结束'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    database.close()
  } }
}

test('自动任务按账号组并发调度，满载排队，保留需求尺寸及实际账号快照', async () => {
  const app = setup(['A', 'A', 'B'])
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '自动画布' })
    const drafts = []
    for (let i = 0; i < 3; i++) drafts.push(await app.service.createNode({ id: randomUUID(), boardId: board.id,
      title: `任务${i}`, prompt: '横幅', size: '1280x720', accountId: null, references: [] }))
    await app.service.submitFromMcp({ boardId: board.id, requestKey: 'batch', nodes: drafts.map((node) => ({ id: node.id, expectedRevision: node.revision })) }, () => undefined)
    await waitFor(() => app.calls.length === 2)
    assert.equal(app.repository.nodes().filter((node) => node.status === 'queued').length, 1)
    assert.equal(new Set(app.calls.map((call) => call.node.accountSnapshot?.accountGroup)).size, 2)
    assert.ok(app.calls.every((call) => call.node.size === '1280x720' && call.node.automaticAccount))
    app.calls[0]!.complete({ b64_json: 'result' })
    await waitFor(() => app.calls.length === 3)
    assert.ok(app.repository.node(app.calls[0]!.node.id).assetId)
    assert.equal(app.repository.submission('batch')?.nodeIds.length, 3)
  } finally { await app.close() }
})

test('首次提交和已删除未发送来源草稿的副本都可提交，不误报在途', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '首次提交' })
    const fields = { boardId: board.id, title: '未提交草稿', prompt: '横幅', size: '1280x720' as const, accountId: null, references: [] }
    const original = await app.service.createNode({ ...fields, id: randomUUID() })
    const copy = await app.service.createNode({ ...fields, id: randomUUID(), sourceNodeId: original.id })
    await app.service.deleteNodes({ boardId: board.id, nodes: [{ id: original.id, expectedRevision: original.revision }] })
    const queued = await app.service.submit({ nodes: [{ id: copy.id, expectedRevision: copy.revision }], confirmed: true })
    assert.equal(queued[0]?.status, 'queued')
    await waitFor(() => app.calls.length === 1)
    assert.equal(app.calls[0]?.node.id, copy.id)
    assert.ok(app.repository.node(original.id).deletedAt)
    assert.equal(app.repository.node(original.id).submittedAt, null)
    const fresh = await app.service.createNode({ ...fields, id: randomUUID() })
    await app.service.submit({ nodes: [{ id: fresh.id, expectedRevision: fresh.revision }], confirmed: true })
    await waitFor(() => app.calls.length === 2)
    assert.equal(app.calls[1]?.node.id, fresh.id)
  } finally { await app.close() }
})

test('副本提交仍阻断真正在途和受理不明的来源，错误指明来源任务', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '来源检查' })
    const fields = { boardId: board.id, title: '来源任务甲', prompt: '横幅', size: '1280x720' as const, accountId: null, references: [] }
    const original = await app.service.createNode({ ...fields, id: randomUUID() })
    const copy = await app.service.createNode({ ...fields, title: '副本', id: randomUUID(), sourceNodeId: original.id })
    let revision = original.revision
    for (const status of ['queued', 'preparing', 'generating', 'downloading', 'acceptance_unknown'] as const) {
      app.repository.saveNodes([{ ...original, revision: revision + 1, status }], [revision])
      revision++
      await assert.rejects(app.service.submit({ nodes: [{ id: copy.id, expectedRevision: copy.revision }], confirmed: true }),
        status === 'acceptance_unknown' ? /来源任务甲.*受理不明/ : /来源任务甲.*仍在途/)
      assert.equal(app.repository.node(copy.id).status, 'draft')
      assert.equal(app.calls.length, 0)
    }
  } finally { await app.close() }
})

test('重新生成追加独立请求和输出，不覆盖原快照及原图', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '连续生成' })
    const fields = { boardId: board.id, title: '同一个图片任务', prompt: '原画面', size: '1280x720' as const, accountId: null, references: [] }
    const original = await app.service.createNode({ ...fields, id: randomUUID() })
    await app.service.submit({ nodes: [{ id: original.id, expectedRevision: original.revision }], confirmed: true })
    await waitFor(() => app.calls.length === 1)
    app.calls[0]!.complete({ b64_json: 'first-result' })
    await waitFor(() => app.repository.node(original.id).status === 'saved' && !app.service.hasActivity())
    const previous = app.repository.node(original.id)
    const output = app.repository.output(original.id)
    const next = await app.service.createNode({ ...fields, prompt: '修改后的画面', id: randomUUID(), sourceNodeId: original.id })
    await app.service.submit({ nodes: [{ id: next.id, expectedRevision: next.revision }], confirmed: true })
    await waitFor(() => app.calls.length === 2)
    app.calls[1]!.complete({ b64_json: 'second-result' })
    await waitFor(() => app.repository.node(next.id).status === 'saved' && !app.service.hasActivity())
    assert.deepEqual(app.repository.node(original.id), previous)
    assert.deepEqual(app.repository.output(original.id), output)
    assert.notEqual(app.repository.node(next.id).assetId, previous.assetId)
    assert.equal(app.repository.node(next.id).sourceNodeId, original.id)
    assert.equal(app.repository.node(next.id).prompt, '修改后的画面')
    assert.equal(app.calls.length, 2)
  } finally { await app.close() }
})

test('请求键持久化幂等；旧修订重试只查询原批次，不再次发送', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const draft = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '图', size: '1280x720', accountId: null, references: [] })
    const input = { boardId: board.id, requestKey: 'once', nodes: [{ id: draft.id, expectedRevision: draft.revision }] }
    await app.service.submitFromMcp(input, () => undefined)
    await waitFor(() => app.calls.length === 1)
    const result = await app.service.submitFromMcp(input, () => undefined)
    assert.equal(result[0]!.id, draft.id)
    assert.equal(app.calls.length, 1)
    const reloaded = new SqliteImageGenerationRepository(app.database)
    assert.equal(reloaded.submission('once')?.nodeIds[0], draft.id)
    await assert.rejects(app.service.submitFromMcp({ ...input, nodes: [{ id: draft.id, expectedRevision: 999 }] }, () => undefined), /不同内容/)
    await assert.rejects(app.service.submitFromMcp({ ...input, requestKey: 'another' }, () => undefined), /更新/)
  } finally { await app.close() }
})

test('受理不明不换号重提；撤销授权阻止尚未发送任务', async () => {
  const app = setup()
  try {
    app.service.saveSettings({ globalConcurrency: 1 })
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const drafts = []
    for (let i = 0; i < 2; i++) drafts.push(await app.service.createNode({ id: randomUUID(), boardId: board.id,
      title: `任务${i}`, prompt: '图', size: '1280x720', accountId: null, references: [] }))
    let allowed = true
    const authorize = () => { if (!allowed) throw new Error('已撤销') }
    await app.service.submitFromMcp({ boardId: board.id, requestKey: 'revoke', nodes: drafts.map((node) => ({ id: node.id, expectedRevision: node.revision })) }, authorize)
    await waitFor(() => app.calls.length === 1)
    app.calls[0]!.fail(new ImageHttpError(500))
    await waitFor(() => app.repository.node(drafts[0]!.id).status === 'acceptance_unknown')
    assert.equal(app.calls.length, 1)
    assert.equal(app.repository.node(drafts[1]!.id).status, 'queued')
    allowed = false
    app.service.saveSettings({ globalConcurrency: 2 })
    await waitFor(() => app.repository.node(drafts[1]!.id).status === 'not_submitted')
    assert.equal(app.calls.length, 1)
  } finally { await app.close() }
})

test('无兼容尺寸账号不入队，独立提交权限默认关闭且要求生成和写权限', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const draft = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '方图', prompt: '图', size: '1024x1024', accountId: null, references: [] })
    await assert.rejects(app.service.submitFromMcp({ boardId: board.id, requestKey: 'size', nodes: [{ id: draft.id, expectedRevision: 1 }] }, () => undefined), /尺寸/)
    assert.equal(app.repository.submission('size'), null)
    assert.equal(app.repository.node(draft.id).status, 'draft')
    const input = { projectId: randomUUID(), minutes: 60, writeEnabled: true, imageGenerationEnabled: true }
    assert.equal(startAssetMcpSchema.parse(input).imageSubmissionEnabled, false)
    assert.equal(startAssetMcpSchema.safeParse({ ...input, writeEnabled: false, imageSubmissionEnabled: true }).success, false)
    assert.equal(startAssetMcpSchema.safeParse({ ...input, imageGenerationEnabled: false, imageSubmissionEnabled: true }).success, false)
    assert.equal(assetMcpPreferencesSchema.parse({ ...input, allProjects: false, importDirectory: '' }).imageSubmissionEnabled, false)
  } finally { await app.close() }
})

test('实际发送边界再次复核授权，编码期间撤销不发出请求', async () => {
  let release: (() => void) | undefined
  const app = setup(['A'], () => new Promise<void>((resolve) => { release = resolve }))
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const node = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '图片', prompt: '图', size: '1280x720', accountId: null, references: [] })
    let allowed = true
    await app.service.submitFromMcp({ boardId: board.id, requestKey: 'sending', nodes: [{ id: node.id, expectedRevision: 1 }] },
      () => { if (!allowed) throw new Error('授权已撤销') })
    await waitFor(() => Boolean(release))
    allowed = false
    release!()
    await waitFor(() => app.repository.node(node.id).status === 'not_submitted')
    assert.equal(app.calls.length, 0)
    assert.equal(app.repository.node(node.id).submittedAt, null)
  } finally { release?.(); await app.close() }
})

test('固定账号不随自动任务换号；明确限流暂停原组，后续自动任务使用其他组', async () => {
  const app = setup()
  try {
    app.service.saveSettings({ globalConcurrency: 1 })
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const fixed = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '固定账号', prompt: '图', size: '1280x720', accountId: app.accounts[0]!.id, references: [] })
    const auto = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '自动账号', prompt: '图', size: '1280x720', accountId: null, references: [] })
    await app.service.submitFromMcp({ boardId: board.id, requestKey: 'limit', nodes: [fixed, auto].map((node) => ({ id: node.id, expectedRevision: 1 })) }, () => undefined)
    await waitFor(() => app.calls.length === 1)
    assert.equal(app.calls[0]!.accountId, app.accounts[0]!.id)
    assert.equal(app.calls[0]!.node.automaticAccount, false)
    app.calls[0]!.fail(new ImageHttpError(429))
    await waitFor(() => app.calls.length === 2)
    assert.equal(app.repository.node(fixed.id).status, 'not_submitted')
    assert.equal(app.calls[1]!.accountId, app.accounts[1]!.id)
    assert.equal(app.calls[1]!.node.id, auto.id)
    assert.equal(app.repository.accounts().find((item) => item.account.id === app.accounts[0]!.id)?.account.stopped, true)
  } finally { await app.close() }
})
