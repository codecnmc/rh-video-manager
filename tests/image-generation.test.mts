import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ImageGenerationService, ImageHttpError, ImageRequestError } from '../src/main/modules/image-generation/application/image-generation-service.ts'
import type { ImageGateway } from '../src/main/modules/image-generation/ports/image-generation.ts'
import { SqliteImageGenerationRepository } from '../src/main/modules/image-generation/adapters/sqlite-image-generation-repository.ts'
import { createImageNodeSchema, defaultImageSize, imageBoardSchema, imageNodeSchema, imageTaskStatusSchema, submitImageNodesSchema } from '../src/shared/contracts/image-generation.ts'
import { occupiesImageCapacity, isImageDraft } from '../src/main/modules/image-generation/domain/task-policy.ts'
import { assetMcpPreferencesSchema } from '../src/shared/contracts/mcp.ts'
import type { Asset } from '../src/shared/contracts/assets.ts'

function setup(gateway?: Omit<ImageGateway, 'diagnoseOutput'>, cachedOutput?: string, referenceAsset?: Asset) {
  const database = new DatabaseSync(':memory:')
  database.exec('CREATE TABLE workspace_trash (id TEXT PRIMARY KEY)')
  const repository = new SqliteImageGenerationRepository(database)
  let generated = 0
  const service = new ImageGenerationService(repository, {
    get(id) { if (referenceAsset?.id === id) return referenceAsset; throw new Error('素材不存在') },
    path() { throw new Error('不得读取参考文件') },
    register(node) { if (cachedOutput) return node.id; throw new Error('不得归档') },
    async assertProject() {}
  }, {
    seal() { throw new Error('不得读取凭据') },
    open() { if (gateway) return cachedOutput ?? 'test-only'; throw new Error('不得读取凭据') }
  }, { ...(gateway ?? {
    async generate() { generated++; throw new Error('不得发起生图') },
    async saveOutput() { throw new Error('不得下载') }
  }), async diagnoseOutput(output, origin) {
    return { kind: output.url ? 'url' : 'inline', downloadOrigin: output.url ? new URL(output.url).origin : null,
      sameServiceOrigin: output.url ? new URL(output.url).origin === origin : false, network: output.url ? 'fake_ip' : 'not_needed', fakeIpAllowed: Boolean(origin) }
  } }, randomUUID)
  return { database, repository, service, generated: () => generated }
}

test('生成结果无需审核即可手动引用，仍校验素材修订且保留历史审核字段', async () => {
  const asset: Asset = { id: randomUUID(), projectId: null, categoryId: null, kind: 'image', name: '已生成图片', tags: [], prompt: '', notes: '',
    size: 8, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z', archived: false }
  const app = setup(undefined, undefined, asset)
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '参考图' })
    const fields = { boardId: board.id, title: '任务', prompt: '画面', size: '1280x720' as const, accountId: null, references: [] }
    const source = await app.service.createNode({ ...fields, id: randomUUID() })
    const saved = { ...source, status: 'saved' as const, assetId: asset.id, revision: 2 }
    app.repository.saveNodes([saved], [source.revision])
    for (const review of ['pending', 'rejected', 'approved'] as const) {
      const current = app.repository.node(source.id)
      app.repository.saveNodes([{ ...current, review, revision: current.revision + 1 }], [current.revision])
      const created = await app.service.createNode({ ...fields, id: randomUUID(), references: [{ assetId: asset.id, expectedUpdatedAt: asset.updatedAt }] })
      assert.equal(created.references[0]?.assetId, asset.id)
      assert.equal(app.repository.node(source.id).review, review)
    }
    await assert.rejects(app.service.createNode({ ...fields, id: randomUUID(), references: [{ assetId: asset.id, expectedUpdatedAt: '2026-10-27T00:00:00.000Z' }] }), /重新选择/)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('软删除同步移除任务查询，保留历史且禁止保存、提交及同 ID 复活', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const input = { id: randomUUID(), boardId: board.id, title: '旧五格', prompt: '待废弃', size: '1280x720' as const, accountId: null, references: [] }
    const node = await app.service.createNode(input)
    const action = { id: node.id, expectedRevision: node.revision }
    await assert.rejects(app.service.deleteNodes({ boardId: board.id, nodes: [{ ...action, expectedRevision: 2 }] }), /更新/)
    await assert.rejects(app.service.deleteNodes({ boardId: board.id, nodes: [action] }, () => { throw new Error('授权已撤销') }), /授权/)
    assert.equal(app.service.nodes(board.id).length, 1)
    assert.deepEqual(await app.service.deleteNodes({ boardId: board.id, nodes: [action] }), { ids: [node.id] })
    assert.equal(app.service.nodes(board.id).length, 0)
    const deleted = app.repository.node(node.id)
    assert.ok(deleted.deletedAt)
    assert.equal(deleted.prompt, node.prompt)
    await assert.rejects(app.service.createNode(input), /不能复活/)
    await assert.rejects(app.service.saveNode({ id: node.id, expectedRevision: deleted.revision, title: '复活', prompt: '', size: node.size, accountId: null, references: [] }), /已删除/)
    await assert.rejects(app.service.submit({ nodes: [{ ...action, expectedRevision: deleted.revision }], confirmed: true }), /已删除/)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('删除整批校验归属与在途状态，失败不部分删除，不改变远端状态', async () => {
  for (const status of ['queued', 'preparing', 'generating', 'downloading', 'acceptance_unknown'] as const) {
    const app = setup()
    try {
      const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
      const other = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '其他画布' })
      const create = () => app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '', size: '1280x720', accountId: null, references: [] })
      const draft = await create(), active = await create()
      const actions = [draft, active].map((node) => ({ id: node.id, expectedRevision: node.revision }))
      await assert.rejects(app.service.deleteNodes({ boardId: other.id, nodes: actions }), /不属于/)
      app.repository.saveNodes([{ ...active, revision: 2, status }], [active.revision])
      actions[1]!.expectedRevision = 2
      await assert.rejects(app.service.deleteNodes({ boardId: board.id, nodes: actions }), /不能删除/)
      assert.equal(app.service.nodes(board.id).length, 2)
      assert.equal(app.repository.node(active.id).status, status)
      assert.equal(app.repository.node(draft.id).deletedAt, undefined)
    } finally { app.service.stop(); app.database.close() }
  }
})

test('重试保留来源和原记录；受理不明解除后可派生但不会自动提交', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '任务组' })
    const fields = { boardId: board.id, title: '重试', prompt: '原提示词', size: '1280x720' as const, accountId: null, references: [] }
    const original = await app.service.createNode({ ...fields, id: randomUUID() })
    app.repository.saveNodes([{ ...original, revision: 2, status: 'acceptance_unknown' }], [1])
    const retry = { ...fields, id: randomUUID(), sourceNodeId: original.id }
    await assert.rejects(app.service.createNode(retry), /受理不明/)
    const resolved = await app.service.resolveUnknown({ id: original.id, expectedRevision: 2, confirmed: true })
    const created = await app.service.createNode(retry)
    assert.equal(created.sourceNodeId, original.id)
    assert.equal(created.status, 'draft')
    assert.equal(app.repository.node(original.id).revision, resolved.revision)
    assert.equal(app.repository.node(original.id).status, 'resolved')
    assert.deepEqual(await app.service.createNode(retry), created)
    await assert.rejects(app.service.createNode({ ...retry, sourceNodeId: undefined }), /不同内容/)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('重试不能派生自在途、已删除或其他任务组的记录', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '任务组' })
    const other = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '其他任务组' })
    const fields = { boardId: board.id, title: '原任务', prompt: '提示词', size: '1280x720' as const, accountId: null, references: [] }
    const original = await app.service.createNode({ ...fields, id: randomUUID() })
    let revision = original.revision
    for (const status of ['queued', 'preparing', 'generating', 'downloading'] as const) {
      app.repository.saveNodes([{ ...original, revision: revision + 1, status }], [revision])
      revision++
      await assert.rejects(app.service.createNode({ ...fields, id: randomUUID(), sourceNodeId: original.id }), /仍在途/)
    }
    app.repository.saveNodes([{ ...original, revision: revision + 1, status: 'not_submitted' }], [revision])
    revision++
    await assert.rejects(app.service.createNode({ ...fields, boardId: other.id, id: randomUUID(), sourceNodeId: original.id }), /不可用/)
    const retry = await app.service.createNode({ ...fields, id: randomUUID(), sourceNodeId: original.id })
    assert.equal(retry.status, 'draft')
    await app.service.deleteNodes({ boardId: board.id, nodes: [{ id: original.id, expectedRevision: revision }] })
    await assert.rejects(app.service.createNode({ ...fields, id: randomUUID(), sourceNodeId: original.id }), /不可用/)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('创建本地任务不需要账号、不访问凭据且不生成；重复创建按明确字段幂等', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const input = { id: randomUUID(), boardId: board.id, title: '任务', prompt: '一张图片', size: '1280x720' as const, accountId: null, references: [] }
    const saved = await app.service.createNode(input)
    assert.equal(saved.status, 'draft')
    assert.equal(saved.finishedAt, null)
    assert.equal(saved.accountSnapshot, null)
    assert.deepEqual(await app.service.createNode({ references: [], accountId: null, size: input.size, prompt: input.prompt,
      title: input.title, boardId: board.id, id: input.id }), saved)
    await assert.rejects(app.service.createNode({ ...input, prompt: '不同内容' }), /不同内容/)
    await assert.rejects(app.service.submit({ nodes: [{ id: saved.id, expectedRevision: saved.revision }], confirmed: true }), /账号/)
    await assert.rejects(app.service.retryOutput({ id: saved.id, expectedRevision: saved.revision }), /不能重新生图/)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('新任务省略尺寸默认横版2K，空提示词草稿可保存但不能提交生成', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '自动保存画布' })
    const input = createImageNodeSchema.parse({ id: randomUUID(), boardId: board.id, title: '待填写', prompt: '', accountId: null, references: [] })
    assert.equal(input.size, defaultImageSize)
    const node = await app.service.createNode(input)
    assert.equal(node.size, '2048x1152')
    await assert.rejects(app.service.submit({ nodes: [{ id: node.id, expectedRevision: node.revision }], confirmed: true }), /提示词/)
    assert.equal(app.generated(), 0)
    assert.equal(createImageNodeSchema.parse({ ...input, size: '720x1280' }).size, '720x1280')
  } finally { app.service.stop(); app.database.close() }
})

test('请求发送边界区分本地失败、HTTP 拒绝和受理不明，不自动重提', async () => {
  for (const scenario of [
    { sending: false, error: new ImageRequestError('DNS 解析失败'), status: 'not_submitted', message: /DNS.*尚未发送/, stopped: false },
    { sending: true, error: new ImageHttpError(401), status: 'not_submitted', message: /HTTP 401.*拒绝/, stopped: true },
    { sending: true, error: new ImageHttpError(500), status: 'acceptance_unknown', message: /HTTP 500.*远端结果未确认/, stopped: false },
    { sending: true, error: new ImageRequestError('图片请求等待超过 10 分钟'), status: 'acceptance_unknown', message: /10 分钟.*远端结果未确认/, stopped: false }
  ]) {
    let calls = 0
    const app = setup({
      async generate(_account, _key, _node, _paths, _signal, onSending) {
        calls++
        if (scenario.sending) onSending()
        throw scenario.error
      },
      async saveOutput() { throw new Error('不得下载') }
    })
    try {
      const accountId = randomUUID()
      app.repository.saveAccount({ account: { id: accountId, revision: 1, name: '测试', baseUrl: 'https://example.invalid',
        model: 'image-test', accountGroup: 'test', maxConcurrency: 1, enabled: true, stopped: false }, cipher: new Uint8Array(), fingerprint: 'test' }, 0)
      const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '发送边界' })
      const node = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '图片', size: '1280x720', accountId, references: [] })
      await app.service.submit({ nodes: [{ id: node.id, expectedRevision: node.revision }], confirmed: true })
      for (let turn = 0; turn < 100 && (app.service.hasActivity() || app.repository.node(node.id).status === 'queued'); turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      const saved = app.repository.node(node.id)
      assert.equal(saved.status, scenario.status)
      assert.equal(Boolean(saved.submittedAt), scenario.sending)
      assert.match(saved.error, scenario.message)
      assert.equal(occupiesImageCapacity(saved), scenario.status === 'acceptance_unknown')
      assert.equal(app.repository.accounts()[0]!.account.stopped, scenario.stopped)
      assert.equal(calls, 1)
    } finally { app.service.stop(); app.database.close() }
  }
})

test('退出恢复不重新提交：排队退回确认，生成保留占用，下载只允许恢复结果', async () => {
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '恢复' })
    const expected = { queued: 'not_submitted', preparing: 'acceptance_unknown', generating: 'acceptance_unknown', downloading: 'output_unavailable' }
    for (const [status] of Object.entries(expected)) {
      const node = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: status, prompt: '图片', size: '1024x1024', accountId: null, references: [] })
      app.repository.saveNodes([imageNodeSchema.parse({ ...node, status, revision: node.revision + 1 })], [node.revision])
    }
    app.service.restore()
    for (const node of app.service.nodes(board.id)) assert.equal(node.status, expected[node.title as keyof typeof expected])
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})

test('恢复归档等待真实完成、反馈安全错误，可再次恢复成功且不重新生成', async () => {
  let generations = 0
  let downloads = 0
  let finishDownload: (() => void) | undefined
  const origin = 'https://provider.example.com'
  const app = setup({
    async generate() { generations++; throw new Error('不得重新生图') },
    async saveOutput(_id, _output, _signal, trustedServiceOrigin) {
      downloads++
      assert.equal(trustedServiceOrigin, origin)
      if (downloads === 1) {
        await new Promise<void>((resolve) => { finishDownload = resolve })
        throw new ImageHttpError(403)
      }
      if (downloads === 2) throw new Error('secret-signed-url-must-not-leak')
      return { storedName: 'saved.png', size: 10 }
    }
  }, JSON.stringify({ url: `${origin}/result.png` }))
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '恢复结果' })
    const created = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '图片', size: '1280x720', accountId: null, references: [] })
    const node = imageNodeSchema.parse({ ...created, revision: 2, status: 'output_unavailable', accountSnapshot: {
      id: randomUUID(), name: '测试', baseUrl: origin, model: 'image-test', accountGroup: 'test'
    } })
    app.repository.saveNodes([node], [created.revision])
    app.repository.saveOutput(node.id, new Uint8Array([1]))
    const pending = app.service.retryOutput({ id: node.id, expectedRevision: node.revision })
    const rejected = assert.rejects(pending, /下载或保存图片文件失败：服务返回 HTTP 403/)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(app.repository.node(node.id).status, 'downloading')
    assert.equal(app.service.hasActivity(), true)
    assert.ok(finishDownload)
    finishDownload()
    await rejected
    const failed = app.repository.node(node.id)
    assert.equal(failed.status, 'output_unavailable')
    assert.ok(app.repository.output(node.id))
    assert.equal(app.service.hasActivity(), false)
    await assert.rejects(app.service.retryOutput({ id: node.id, expectedRevision: failed.revision }), /操作未完成/)
    const safeFailure = app.repository.node(node.id)
    assert.doesNotMatch(safeFailure.error, /secret-signed-url/)
    await app.service.retryOutput({ id: node.id, expectedRevision: safeFailure.revision })
    const saved = app.repository.node(node.id)
    assert.equal(saved.status, 'saved')
    assert.equal(saved.assetId, node.id)
    assert.equal(saved.error, '')
    assert.equal(generations, 0)
    assert.equal(downloads, 3)
  } finally { app.service.stop(); app.database.close() }
})

test('只有未提交状态可编辑；受理不明持续占用账号容量', () => {
  const node = imageNodeSchema.parse({ id: randomUUID(), boardId: randomUUID(), projectId: null, title: '任务', prompt: '图片',
    size: '1024x1024', accountId: null, references: [], revision: 1, status: 'draft', createdAt: '', updatedAt: '', submittedAt: null,
    accountSnapshot: null, assetId: null, review: 'pending', error: '' })
  for (const status of imageTaskStatusSchema.options) {
    assert.equal(isImageDraft({ ...node, status }), ['draft', 'not_submitted'].includes(status))
    assert.equal(occupiesImageCapacity({ ...node, status }), ['preparing', 'generating', 'acceptance_unknown'].includes(status))
  }
  assert.equal(submitImageNodesSchema.safeParse({ nodes: [{ id: node.id, expectedRevision: 1 }], confirmed: false }).success, false)
})

test('旧 MCP 偏好默认不授权素材生成', () => {
  const preferences = assetMcpPreferencesSchema.parse({ projectId: null, allProjects: true, writeEnabled: true, minutes: 60, importDirectory: 'D:/imports' })
  assert.equal(preferences.imageGenerationEnabled, false)
})

test('诊断只返回脱敏源站和网络分类；MCP 恢复立即返回且撤销授权阻断素材登记', async () => {
  let finishDownload: (() => void) | undefined
  let authorized = true
  let generations = 0
  const app = setup({
    async generate() { generations++; throw new Error('不得重新生图') },
    async saveOutput() {
      await new Promise<void>((resolve) => { finishDownload = resolve })
      return { storedName: 'saved.png', size: 10 }
    }
  }, JSON.stringify({ url: 'https://cdn.example.com/private/image.png?signature=secret-do-not-leak' }))
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '诊断' })
    const created = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '图片', size: '1280x720', accountId: null, references: [] })
    const node = imageNodeSchema.parse({ ...created, revision: 2, status: 'output_unavailable', accountSnapshot: {
      id: randomUUID(), name: '测试', baseUrl: 'https://provider.example.com', model: 'image-test', accountGroup: 'test'
    } })
    app.repository.saveNodes([node], [created.revision])
    app.repository.saveOutput(node.id, new Uint8Array([1]))
    const diagnosis = await app.service.diagnoseNode(node.id)
    assert.equal(diagnosis.output?.downloadOrigin, 'https://cdn.example.com')
    assert.equal(diagnosis.output?.sameServiceOrigin, false)
    assert.equal(diagnosis.output?.network, 'fake_ip')
    assert.doesNotMatch(JSON.stringify(diagnosis), /signature|secret-do-not-leak|private\/image/)
    const started = await app.service.startOutputRecovery({ id: node.id, expectedRevision: node.revision }, () => {
      if (!authorized) throw new Error('authorization-revoked-secret')
    })
    assert.equal(started.status, 'downloading')
    assert.equal(app.service.hasActivity(), true)
    await assert.rejects(app.service.startOutputRecovery({ id: node.id, expectedRevision: started.revision }), /可恢复/)
    authorized = false
    assert.ok(finishDownload)
    finishDownload()
    for (let turn = 0; turn < 100 && app.service.hasActivity(); turn++) await new Promise<void>((resolve) => setImmediate(resolve))
    const failed = app.repository.node(node.id)
    assert.equal(failed.status, 'output_unavailable')
    assert.equal(failed.assetId, null)
    assert.ok(app.repository.output(node.id))
    assert.doesNotMatch(failed.error, /authorization-revoked-secret/)
    assert.equal(generations, 0)
  } finally { app.service.stop(); app.database.close() }
})

test('旧画布默认不隐藏节点；移出持久化不删除任务，旧客户端保存布局保留隐藏状态', async () => {
  assert.deepEqual(imageBoardSchema.parse({ id: randomUUID(), projectId: null, title: '旧画布', revision: 1,
    createdAt: '', updatedAt: '', positions: {} }).hiddenNodeIds, [])
  const app = setup()
  try {
    const board = await app.service.createBoard({ id: randomUUID(), projectId: null, title: '画布' })
    const node = await app.service.createNode({ id: randomUUID(), boardId: board.id, title: '任务', prompt: '图片', size: '1024x1024', accountId: null, references: [] })
    const hidden = await app.service.saveLayout({ id: board.id, expectedRevision: board.revision, positions: {}, hiddenNodeIds: [node.id] })
    const saved = await app.service.saveLayout({ id: board.id, expectedRevision: hidden.revision, positions: { [node.id]: { x: 10, y: 20 } } })
    assert.deepEqual(app.service.board(board.id).hiddenNodeIds, [node.id])
    assert.deepEqual(saved.hiddenNodeIds, [node.id])
    assert.equal(app.service.nodes(board.id).length, 1)
    assert.equal(app.generated(), 0)
  } finally { app.service.stop(); app.database.close() }
})
