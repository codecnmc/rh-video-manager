import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import { AssetMcpServer, assetMcpPort } from '../src/main/mcp/asset-server.ts'
import { WorkbenchDatabase, SqliteWorkspaceRepository } from '../src/main/infrastructure/database/workspace-repository.ts'
import { WorkspaceService } from '../src/main/application/workspace-service.ts'
import { WorkspaceDraftService } from '../src/main/application/workspace-draft-service.ts'
import { ProjectService } from '../src/main/modules/projects/application/project-service.ts'
import { ScriptService } from '../src/main/modules/scripts/application/script-service.ts'
import { VideoService } from '../src/main/modules/video/application/video-service.ts'
import { SqliteScriptRepository } from '../src/main/infrastructure/database/script-repository.ts'
import { SqliteVideoDraftRepository } from '../src/main/infrastructure/database/video-repository.ts'
import { SqliteReferenceRepository } from '../src/main/infrastructure/database/reference-repository.ts'
import { ReferenceService } from '../src/main/modules/assets/application/reference-service.ts'
import { videoDraftSchema } from '../src/shared/contracts/video.ts'
import { SqliteProjectRepository } from '../src/main/infrastructure/database/project-repository.ts'
import { SqliteAssetRepository } from '../src/main/infrastructure/database/asset-repository.ts'
import { LibraryService } from '../src/main/modules/assets/application/library-service.ts'
import type { AssetFiles } from '../src/main/modules/assets/ports/library.ts'
import { SettingsService } from '../src/main/modules/settings/application/settings-service.ts'
import { SqlitePreferencesRepository } from '../src/main/infrastructure/database/preferences-repository.ts'
import { startAssetMcpSchema } from '../src/shared/contracts/mcp.ts'
import { ScriptLibraryService } from '../src/main/modules/scripts/application/script-library-service.ts'
import { SqliteScriptLibraryRepository } from '../src/main/infrastructure/database/script-library-repository.ts'
import { libraryDocumentSchema } from '../src/shared/contracts/script-library.ts'
import { AssemblyService } from '../src/main/modules/assembly/application/assembly-service.ts'
import { SqliteAssemblyRepository } from '../src/main/modules/assembly/adapters/sqlite-assembly-repository.ts'
import { assemblyContentSchema, assemblyDocumentSchema } from '../src/shared/contracts/assembly.ts'
import type { MediaInspector } from '../src/main/application/media-inspector.ts'
import { ImageGenerationService } from '../src/main/modules/image-generation/application/image-generation-service.ts'
import { SqliteImageGenerationRepository } from '../src/main/modules/image-generation/adapters/sqlite-image-generation-repository.ts'
import { imageNodeSchema, imageAccountSchema } from '../src/shared/contracts/image-generation.ts'

async function setup(includeDrafts = false, inspector?: MediaInspector) {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-mcp-test-'))
  const database = new WorkbenchDatabase(':memory:')
  const projectId = randomUUID()
  const otherProjectId = randomUUID()
  const projects = new SqliteProjectRepository(database.connection)
  projects.upsert({ id: projectId, name: 'MCP 测试项目', sample: false }, 0)
  projects.upsert({ id: otherProjectId, name: '隔离项目', sample: false }, 1)
  let imports = 0
  // 协议与 SQLite 使用真实实现；仅替换受管媒体复制端口，避免依赖 Electron。
  const files: AssetFiles = {
    localPath: async (name) => ({ path: join(directory, name), size: 8 }),
    readImage: async () => ({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mimeType: 'image/png' }),
    import: async (id, path) => { imports += 1; return { storedName: `${id}.png`, name: basename(path), size: 8 } },
    importImage: async () => { throw new Error('此测试不使用剪贴板') },
    discard: async () => undefined, reveal: () => undefined, resolve: (name) => join(directory, name)
  }
  const assembly = new AssemblyService(new SqliteAssemblyRepository(database.connection), { get: (id) => library.get(id) }, randomUUID)
  const library: LibraryService = new LibraryService(new SqliteAssetRepository(database.connection), files, randomUUID, (id) => {
    if (assembly.references(id)) throw new Error('素材仍被排片引用')
  })
  const listProjects = async () => projects.list().filter(project => !database.connection.prepare('SELECT 1 FROM workspace_trash WHERE id = ?').get(project.id))
    .map(({ id, name }) => ({ id, name }))
  const references = new ReferenceService(new SqliteReferenceRepository(database.connection), library, randomUUID)
  const workspace = new WorkspaceService(new SqliteWorkspaceRepository(database.connection, new ProjectService(projects),
    new ScriptService(new SqliteScriptRepository(database.connection)), new VideoService(new SqliteVideoDraftRepository(database.connection))),
  () => ({ version: 1, revision: 0, updatedAt: new Date().toISOString(), projects: projects.list().map(project => ({ ...project, episodes: [], videoDrafts: [] })) }))
  await workspace.load()
  const drafts = new WorkspaceDraftService(workspace, references)
  const scripts = new ScriptLibraryService(new SqliteScriptLibraryRepository(database.connection), randomUUID)
  const server = new AssetMcpServer(library, 0, listProjects, includeDrafts ? drafts : undefined, undefined, scripts, assembly, inspector)
  return { directory, database, projectId, otherProjectId, library, files, server, workspace, references, drafts, scripts, assembly, get imports() { return imports },
    async close() { server.stop(); database.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('导入目录查询仅返回当前授权目录，只读重连不泄露历史目录', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    const response = await client.callTool({ name: 'assets_import_directory', arguments: {} })
    assert.equal(response.isError, undefined)
    assert.deepEqual(response.content, [{ type: 'text', text: JSON.stringify({
      writeEnabled: true, importDirectory: await realpath(app.directory), expiresAt: null
    }) }])
    await client.close(); app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: 5 }, app.directory)
    client = await connect(app.server)
    const readonly = await client.callTool({ name: 'assets_import_directory', arguments: {} })
    assert.equal(readonly.isError, undefined)
    assert.deepEqual(readonly.content, [{ type: 'text', text: JSON.stringify({
      writeEnabled: false, importDirectory: null, expiresAt: app.server.status().expiresAt
    }) }])
  } finally {
    await client?.close()
    await app.close()
  }
})

function connection(server: AssetMcpServer) {
  const token = /Bearer ([A-Za-z0-9_-]+)/.exec(server.configuration())?.[1]
  assert.ok(token)
  return { url: server.status().url, authorization: `Bearer ${token}` }
}

test('素材生成 MCP 诊断隔离项目、脱敏结果；恢复仅写权限可见且不重复生成', async () => {
  const app = await setup()
  const repository = new SqliteImageGenerationRepository(app.database.connection)
  let downloads = 0
  let generations = 0
  const images = new ImageGenerationService(repository, {
    get: (id) => app.library.get(id), path: () => { throw new Error('不得读取参考文件') },
    register: (node) => node.id, async assertProject() {}
  }, { seal() { throw new Error('不得存取账号凭据') }, open: () => JSON.stringify({ url: 'https://cdn.example.com/image.png?signature=secret' }) }, {
    async generate() { generations++; throw new Error('不得生成') },
    async saveOutput() { downloads++; return { storedName: 'saved.png', size: 10 } },
    async diagnoseOutput() { return { kind: 'url', downloadOrigin: 'https://cdn.example.com', sameServiceOrigin: false, network: 'fake_ip', fakeIpAllowed: true } }
  }, randomUUID)
  const server = new AssetMcpServer(app.library, 0, async () => [{ id: app.projectId, name: '本项目' }, { id: app.otherProjectId, name: '隔离项目' }],
    undefined, undefined, undefined, undefined, undefined, undefined, images)
  let client: Client | undefined
  try {
    const ownBoard = await images.createBoard({ id: randomUUID(), projectId: app.projectId, title: '画布' })
    const otherBoard = await images.createBoard({ id: randomUUID(), projectId: app.otherProjectId, title: '隔离画布' })
    const create = async (boardId: string) => {
      const draft = await images.createNode({ id: randomUUID(), boardId, title: '任务', prompt: '提示词', size: '1280x720', accountId: null, references: [] })
      const node = imageNodeSchema.parse({ ...draft, revision: 2, status: 'output_unavailable' })
      repository.saveNodes([node], [draft.revision])
      repository.saveOutput(node.id, new Uint8Array([1]))
      return node
    }
    const own = await create(ownBoard.id)
    const other = await create(otherBoard.id)
    await server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, imageGenerationEnabled: false }, '')
    client = await connect(server)
    assert.equal((await client.listTools()).tools.some((tool) => tool.name === 'image_node_diagnose'), false)
    await client.close(); server.stop()
    await server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, imageGenerationEnabled: true }, '')
    client = await connect(server)
    const readTools = (await client.listTools()).tools.map((tool) => tool.name)
    assert.ok(readTools.includes('image_node_diagnose'))
    assert.ok(readTools.includes('image_protocols_list'))
    assert.equal(readTools.includes('image_nodes_submit'), false)
    assert.equal(readTools.includes('image_nodes_delete'), false)
    const protocols = await client.callTool({ name: 'image_protocols_list', arguments: {} })
    assert.equal(protocols.isError, undefined)
    assert.match(JSON.stringify(protocols.content), /submitGeneration/)
    assert.equal(readTools.includes('image_output_recover'), false)
    const diagnosis = await client.callTool({ name: 'image_node_diagnose', arguments: { boardId: ownBoard.id, id: own.id } })
    assert.equal(diagnosis.isError, undefined)
    assert.match(JSON.stringify(diagnosis), /cdn\.example\.com/)
    assert.doesNotMatch(JSON.stringify(diagnosis), /signature|secret|image\.png/)
    assert.equal((await client.callTool({ name: 'image_node_diagnose', arguments: { boardId: otherBoard.id, id: other.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'image_node_diagnose', arguments: { boardId: ownBoard.id, id: other.id } })).isError, true)
    await client.close(); server.stop()
    await server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1, imageGenerationEnabled: true }, app.directory)
    client = await connect(server)
    const writeTools = (await client.listTools()).tools.map((tool) => tool.name)
    assert.ok(writeTools.includes('image_output_recover'))
    assert.equal(writeTools.includes('image_nodes_submit'), false)
    assert.equal(writeTools.some((name) => /image.*submit|image.*account/.test(name)), false)
    const args = { boardId: ownBoard.id, id: own.id, expectedRevision: own.revision, confirmed: true, requestKey: 'recover-existing-result' }
    assert.equal((await client.callTool({ name: 'image_output_recover', arguments: { ...args, confirmed: false } })).isError, true)
    assert.equal((await client.callTool({ name: 'image_output_recover', arguments: { ...args, boardId: otherBoard.id, id: other.id, requestKey: 'outside' } })).isError, true)
    assert.equal((await client.callTool({ name: 'image_output_recover', arguments: args })).isError, undefined)
    assert.equal((await client.callTool({ name: 'image_output_recover', arguments: args })).isError, undefined)
    assert.equal(downloads, 1)
    assert.equal(generations, 0)
    assert.equal(repository.node(own.id).status, 'saved')
    assert.ok(writeTools.includes('image_nodes_delete'))
    const deletion = { boardId: ownBoard.id, nodes: [{ id: own.id, expectedRevision: repository.node(own.id).revision }], requestKey: 'delete-image-node' }
    assert.equal((await client.callTool({ name: 'image_nodes_delete', arguments: { ...deletion, boardId: otherBoard.id, requestKey: 'wrong-board' } })).isError, true)
    assert.equal((await client.callTool({ name: 'image_nodes_delete', arguments: { ...deletion, nodes: [{ id: other.id, expectedRevision: other.revision }], requestKey: 'wrong-node' } })).isError, true)
    const removed = await client.callTool({ name: 'image_nodes_delete', arguments: deletion })
    assert.equal(removed.isError, undefined)
    assert.deepEqual(textResult(await client.callTool({ name: 'image_nodes_delete', arguments: deletion })), textResult(removed))
    assert.equal(images.nodes(ownBoard.id).length, 0)
    assert.ok(repository.node(own.id).deletedAt)
    assert.equal(repository.node(own.id).assetId, own.id)
    assert.equal(downloads, 1)
    assert.equal(generations, 0)
  } finally { await client?.close(); server.stop(); images.stop(); await app.close() }
})

test('生图提交必须单独授权，隔离画布且跨 MCP 重连幂等，不要求逐笔付费确认', async () => {
  const app = await setup()
  const repository = new SqliteImageGenerationRepository(app.database.connection)
  let generations = 0
  const account = imageAccountSchema.parse({ id: randomUUID(), revision: 1, name: '测试账号', baseUrl: 'https://provider.example.com',
    model: 'model', accountGroup: 'one', maxConcurrency: 1, enabled: true, stopped: false })
  repository.saveAccount({ account, cipher: new Uint8Array([1]), fingerprint: 'test' }, 0)
  const images = new ImageGenerationService(repository, {
    get: (id) => app.library.get(id), path() { throw new Error('无参考图') }, register: (node) => node.id, async assertProject() {}
  }, { seal: (value) => ({ cipher: Buffer.from(value), fingerprint: 'test' }), open: () => 'test-key' }, {
    async generate() { generations++; throw new Error('测试仅记录本地调用，不发送网络') },
    async saveOutput() { throw new Error('不下载') },
    async diagnoseOutput() { return { kind: 'empty', downloadOrigin: null, sameServiceOrigin: false, network: 'not_needed', fakeIpAllowed: false } }
  }, randomUUID)
  const server = new AssetMcpServer(app.library, 0, async () => [{ id: app.projectId, name: '项目' }],
    undefined, undefined, undefined, undefined, undefined, undefined, images)
  let client: Client | undefined
  try {
    const board = await images.createBoard({ id: randomUUID(), projectId: app.projectId, title: '画布' })
    const outside = await images.createBoard({ id: randomUUID(), projectId: app.otherProjectId, title: '其他画布' })
    const draft = await images.createNode({ id: randomUUID(), boardId: board.id, title: '图片', prompt: '图', size: '1280x720', accountId: null, references: [] })
    const options = { projectId: app.projectId, minutes: -1, writeEnabled: true, imageGenerationEnabled: true }
    await server.start(options, app.directory)
    client = await connect(server)
    assert.equal((await client.listTools()).tools.some((tool) => tool.name === 'image_nodes_submit'), false)
    await client.close(); server.stop()
    await server.start({ ...options, imageSubmissionEnabled: true }, app.directory)
    client = await connect(server)
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'image_nodes_submit'))
    const input = { boardId: board.id, nodes: [{ id: draft.id, expectedRevision: draft.revision }], requestKey: 'submit-once' }
    assert.equal((await client.callTool({ name: 'image_nodes_submit', arguments: { ...input, boardId: outside.id, requestKey: 'outside' } })).isError, true)
    assert.equal((await client.callTool({ name: 'image_nodes_submit', arguments: input })).isError, undefined)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(generations, 1)
    await client.close(); server.stop()
    await server.start({ ...options, imageSubmissionEnabled: true }, app.directory)
    client = await connect(server)
    assert.equal((await client.callTool({ name: 'image_nodes_submit', arguments: input })).isError, undefined)
    assert.equal(generations, 1)
  } finally { await client?.close(); server.stop(); images.stop(); await app.close() }
})

test('只读 MCP 按素材 ID 返回原图和修订，不泄漏路径并隔离项目', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const create = async (projectId: string | null, kind: 'image' | 'video' = 'image') =>
      (await app.library.import({ projectId, categoryId: null, kind, tags: [], prompt: '', notes: '' }, ['reference.png']))[0]!
    const own = await create(app.projectId)
    const shared = await create(null)
    const other = await create(app.otherProjectId)
    const video = await create(app.projectId, 'video')
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    const read = (asset: typeof own) => client!.callTool({ name: 'assets_read_image', arguments: { assetId: asset.id, expectedUpdatedAt: asset.updatedAt } })
    for (const asset of [own, shared]) {
      const response = await read(asset)
      assert.equal(response.isError, undefined)
      const [metadata, image] = z.tuple([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image'), mimeType: z.literal('image/png'), data: z.string() })
      ]).parse(response.content)
      assert.deepEqual(JSON.parse(metadata.text), { assetId: asset.id, projectId: asset.projectId, name: asset.name,
        updatedAt: asset.updatedAt, size: 8, mimeType: 'image/png' })
      assert.equal(image.data, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'))
      assert.equal(JSON.stringify(response).includes(app.directory), false)
    }
    assert.equal((await read(other)).isError, true)
    assert.equal((await read(video)).isError, true)
    const revised = await app.library.replaceFile({ id: own.id, expectedUpdatedAt: own.updatedAt, path: 'new.png' })
    assert.equal((await read(own)).isError, true)
    assert.equal((await read(revised)).isError, undefined)
    app.library.archive(revised.id, true)
    assert.equal((await read(app.library.get(revised.id))).isError, true)
    app.library.remove(shared.id)
    assert.equal((await read(shared)).isError, true)
  } finally { await client?.close(); await app.close() }
})

test('路径查询只读可用，支持媒体与公共库，隔离项目并拒绝过期、归档和删除素材', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const create = async (projectId: string | null, kind: 'image' | 'video' | 'audio' = 'image') =>
      (await app.library.import({ projectId, categoryId: null, kind, tags: [], prompt: '不应返回的提示词', notes: '' }, ['source.png']))[0]!
    const image = await create(app.projectId)
    const video = await create(app.projectId, 'video')
    const audio = await create(app.projectId, 'audio')
    const shared = await create(null)
    const other = await create(app.otherProjectId)
    const prompt = app.library.savePrompt({ projectId: app.projectId, categoryId: null, name: '纯提示词', prompt: '内容', tags: [], notes: '' })
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    const tool = (await client.listTools()).tools.find((item) => item.name === 'assets_resolve_path')
    assert.equal(tool?.annotations?.readOnlyHint, true)
    const read = (asset: typeof image) => client!.callTool({ name: 'assets_resolve_path', arguments: { assetId: asset.id, expectedUpdatedAt: asset.updatedAt } })
    for (const asset of [image, video, audio, shared]) {
      const response = await read(asset)
      assert.equal(response.isError, undefined)
      assert.deepEqual(textResult(response), { assetId: asset.id, projectId: asset.projectId, name: asset.name,
        kind: asset.kind, updatedAt: asset.updatedAt, size: 8, path: join(app.directory, `${asset.id}.png`) })
      assert.doesNotMatch(JSON.stringify(response), /不应返回的提示词/)
    }
    const outside = await read(other)
    assert.equal(outside.isError, true)
    assert.equal(JSON.stringify(outside).includes(app.directory), false)
    assert.equal((await read(prompt)).isError, true)
    assert.equal((await client.callTool({ name: 'assets_resolve_path', arguments: { path: app.directory } })).isError, true)
    const revised = await app.library.replaceFile({ id: image.id, expectedUpdatedAt: image.updatedAt, path: 'new.png' })
    assert.equal((await read(image)).isError, true)
    assert.equal((await read(revised)).isError, undefined)
    app.library.archive(revised.id, true)
    assert.equal((await read(app.library.get(revised.id))).isError, true)
    app.library.remove(shared.id)
    assert.equal((await read(shared)).isError, true)
    await client.close(); app.server.stop()
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    assert.equal((await read(other)).isError, undefined)
    app.database.connection.prepare('INSERT INTO workspace_trash (id, kind, project_id, snapshot, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(app.otherProjectId, 'project', app.otherProjectId, '{}', new Date().toISOString())
    assert.equal((await read(other)).isError, true)
  } finally { await client?.close(); await app.close() }
})

test('路径查询在异步文件检查后重查修订、授权和文件大小，失败不返回路径', async () => {
  const app = await setup()
  try {
    const [asset] = await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, ['old.png'])
    assert.ok(asset)
    const input = { assetId: asset.id, expectedUpdatedAt: asset.updatedAt }
    const lookup = app.files.localPath
    app.files.localPath = async (name) => {
      await app.library.replaceFile({ id: asset.id, expectedUpdatedAt: asset.updatedAt, path: 'new.png' })
      return lookup(name)
    }
    await assert.rejects(app.library.resolvePath(input, async () => undefined), /已更新/)
    app.files.localPath = lookup
    const current = { ...input, expectedUpdatedAt: app.library.get(asset.id).updatedAt }
    let checks = 0
    await assert.rejects(app.library.resolvePath(current, async () => {
      if (++checks === 2) throw new Error('授权已撤销')
    }), /授权已撤销/)
    app.files.localPath = async (name) => ({ ...(await lookup(name)), size: 9 })
    await assert.rejects(app.library.resolvePath(current, async () => undefined), /文件已变化/)
    app.files.localPath = async () => { throw new Error('文件不存在或不在受管目录') }
    await assert.rejects(app.library.resolvePath(current, async () => undefined), /文件不存在/)
    app.files.localPath = async (name) => {
      app.library.archive(asset.id, true)
      return lookup(name)
    }
    await assert.rejects(app.library.resolvePath(current, async () => undefined), /未归档/)
  } finally { await app.close() }
})

test('路径查询期间撤销 MCP 后不返回路径', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const [asset] = await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'video', tags: [], prompt: '', notes: '' }, ['video.mp4'])
    assert.ok(asset)
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    let lookups = 0
    app.files.localPath = async (name) => {
      lookups += 1
      app.server.stop()
      return { path: join(app.directory, name), size: 8 }
    }
    const response = await client.callTool({ name: 'assets_resolve_path', arguments: { assetId: asset.id, expectedUpdatedAt: asset.updatedAt } }).catch(() => null)
    if (response) {
      assert.equal(response.isError, true)
      assert.equal(JSON.stringify(response).includes(app.directory), false)
    }
    assert.equal(lookups, 1)
    assert.equal(app.server.status().enabled, false)
  } finally { await client?.close(); await app.close() }
})

test('原图读取期间替换文件或撤权时拒绝返回', async () => {
  const app = await setup()
  try {
    const [asset] = await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, ['old.png'])
    assert.ok(asset)
    const read = app.files.readImage
    app.files.readImage = async (name) => {
      await app.library.replaceFile({ id: asset.id, expectedUpdatedAt: asset.updatedAt, path: 'new.png' })
      return read(name)
    }
    await assert.rejects(app.library.readImage(asset.id, asset.updatedAt, async () => undefined), /已更新/)
    app.files.readImage = read
    let checks = 0
    await assert.rejects(app.library.readImage(asset.id, app.library.get(asset.id).updatedAt, async () => {
      if (++checks === 2) throw new Error('授权已撤销')
    }), /授权已撤销/)
  } finally { await app.close() }
})

test('图片替换保留素材元数据、留存旧文件记录并拒绝过期修订和撤权', async () => {
  const app = await setup()
  try {
    const [original] = await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'image', tags: ['角色'], prompt: '五视图', notes: '定稿' }, ['old.png'])
    assert.ok(original)
    const repository = new SqliteAssetRepository(app.database.connection)
    const oldFile = repository.get(original.id).storedName
    const replaced = await app.library.replaceFile({ id: original.id, expectedUpdatedAt: original.updatedAt, path: 'new.png' })
    assert.deepEqual({ ...replaced, updatedAt: original.updatedAt }, original)
    assert.notEqual(repository.get(original.id).storedName, oldFile)
    const history = app.database.connection.prepare('SELECT stored_name FROM asset_file_history WHERE asset_id = ?').get(original.id)
    assert.equal(history?.stored_name, oldFile)
    assert.equal(app.library.list({ projectId: app.projectId }).length, 1)
    await assert.rejects(app.library.replaceFile({ id: original.id, expectedUpdatedAt: original.updatedAt, path: 'stale.png' }), /已更新/)
    let checks = 0
    await assert.rejects(app.library.replaceFile({ id: original.id, expectedUpdatedAt: replaced.updatedAt, path: 'revoked.png' }, async () => {
      if (++checks === 2) throw new Error('授权已撤销')
    }), /授权已撤销/)
    assert.deepEqual(app.library.get(original.id), replaced)
  } finally { await app.close() }
})

test('MCP 图片替换遵守项目授权并幂等执行', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const path = join(app.directory, 'replacement.png')
    await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const [asset] = await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, [path])
    assert.ok(asset)
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    const args = { id: asset.id, expectedUpdatedAt: asset.updatedAt, path, requestKey: 'replace-image' }
    const first = await client.callTool({ name: 'asset_file_replace', arguments: args })
    assert.equal(first.isError, undefined)
    const imports = app.imports
    assert.deepEqual(textResult(await client.callTool({ name: 'asset_file_replace', arguments: args })), textResult(first))
    assert.equal(app.imports, imports)
    assert.equal((await client.callTool({ name: 'asset_file_replace', arguments: { ...args, projectId: app.otherProjectId, requestKey: 'wrong-project' } })).isError, true)
  } finally { await client?.close(); await app.close() }
})

test('MCP 文件夹读取和写入按项目授权隔离，全项目新建必须指定归属', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    for (const projectId of [app.projectId, app.otherProjectId, null]) app.library.saveCategory({ id: null, name: '角色', projectId })
    const other = app.library.categories(app.otherProjectId)[0]!
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    const listed = z.array(z.object({ id: z.string(), projectId: z.string().nullable() })).parse(textResult(await client.callTool({ name: 'asset_categories' })))
    assert.equal(listed.length, 2)
    assert.equal(listed.some((folder) => folder.id === other.id), false)
    assert.equal((await client.callTool({ name: 'asset_categories', arguments: { projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'rename-other', id: other.id, name: '越权修改' } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'child-other', id: null, name: '越权子目录', parentId: other.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'new-own', id: null, name: '当前项目新建' } })).isError, undefined)
    assert.equal(app.library.categories(app.projectId).some((folder) => folder.name === '当前项目新建'), true)
    await client.close(); client = undefined; app.server.stop()
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    assert.equal((await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'missing-project', id: null, name: '未指定' } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'explicit-project', id: null, name: '目标项目', projectId: app.otherProjectId } })).isError, undefined)
    assert.equal(app.library.categories(app.otherProjectId).some((folder) => folder.name === '目标项目'), true)
  } finally { await client?.close(); await app.close() }
})

test('默认端口固定，关闭及实例重建保持地址，占用时拒绝开启且不换端口', async () => {
  const app = await setup()
  const first = new AssetMcpServer(app.library)
  const second = new AssetMcpServer(app.library)
  const input = { projectId: app.projectId, writeEnabled: false, minutes: -1 }
  try {
    const initial = await first.start(input, '')
    assert.equal(initial.url, `http://127.0.0.1:${assetMcpPort}/mcp`)
    const token = connection(first).authorization
    await assert.rejects(second.start(input, ''), /固定端口 5189 已被占用/)
    assert.equal(second.status().enabled, false)
    assert.equal(first.status().enabled, true)
    first.stop()
    const restarted = await first.start(input, '')
    assert.equal(restarted.url, initial.url)
    assert.equal(connection(first).authorization, token)
    first.stop()
    const recreated = await second.start(input, '')
    assert.equal(recreated.url, initial.url)
    const client = await connect(second)
    try { assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['asset_categories', 'assets_list', 'assets_read_image', 'assets_resolve_path']) } finally { await client.close() }
  } finally { first.stop(); second.stop(); await app.close() }
})

async function connect(server: AssetMcpServer) {
  const config = connection(server)
  const client = new Client({ name: 'workbench-local-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { Authorization: config.authorization } } }))
  return client
}

test('固定令牌跨实例复用，手动替换后旧令牌拒绝访问，非法令牌不落库', async () => {
  const app = await setup()
  let saved: string | null = null
  let writes = 0
  const store = { read: () => saved, write: (token: string) => { saved = token; writes += 1 } }
  const first = new AssetMcpServer(app.library, 0, undefined, undefined, store)
  const second = new AssetMcpServer(app.library, 0, undefined, undefined, store)
  const input = { projectId: app.projectId, writeEnabled: false, minutes: -1 }
  try {
    await first.start(input, '')
    const initial = connection(first).authorization
    assert.equal(writes, 1)
    first.stop()
    await second.start(input, '')
    assert.equal(connection(second).authorization, initial)
    assert.equal(writes, 1)
    second.stop()
    await assert.rejects(second.start({ ...input, token: 'short' }, ''))
    assert.equal(writes, 1)
    const replacement = 'manual_mcp_token_0123456789_ABCDEF'
    await second.start({ ...input, token: replacement }, '')
    assert.equal(connection(second).authorization, `Bearer ${replacement}`)
    assert.equal(writes, 2)
    const response = await fetch(second.status().url, { method: 'POST', headers: { Authorization: initial,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
    assert.equal(response.status, 403)
    const client = await connect(second)
    try { assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['asset_categories', 'assets_list', 'assets_read_image', 'assets_resolve_path']) } finally { await client.close() }
    second.stop()
    await first.start(input, '')
    assert.equal(connection(first).authorization, `Bearer ${replacement}`)
    assert.equal(writes, 2)
  } finally { first.stop(); second.stop(); await app.close() }
})

const listedSchema = z.object({ total: z.number(), items: z.array(z.object({ id: z.string(), name: z.string() })) })
function textResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content)
  return JSON.parse(content[0]!.text) as unknown
}

function emptyAssembly(title = '排片测试', episode: number | null = 1) {
  const id = randomUUID()
  return assemblyContentSchema.parse({ title, episode, activeVersionId: id, versions: [{ id, name: '初剪', clips: [], sounds: [] }] })
}

test('排片 MCP 默认不授权，单独启用后只读与项目隔离生效', async () => {
  const app = await setup()
  let client: Client | undefined
  const own = app.assembly.save({ id: null, projectId: app.projectId, expectedRevision: 0, content: emptyAssembly() })
  const other = app.assembly.save({ id: null, projectId: app.otherProjectId, expectedRevision: 0, content: emptyAssembly('其他工程') })
  const common = app.assembly.save({ id: null, projectId: null, expectedRevision: 0, content: emptyAssembly('公共工程') })
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    assert.equal(app.server.status().assemblyEnabled, false)
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name.startsWith('assembly_')))
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: own.id } })).isError, true)
    await client.close(); app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, assemblyEnabled: true }, '')
    client = await connect(app.server)
    assert.deepEqual((await client.listTools()).tools.filter((tool) => tool.name.startsWith('assembly_')).map((tool) => tool.name).sort(), ['assembly_capabilities', 'assembly_get', 'assembly_list'])
    const capability = z.object({ protocolVersion: z.number(), operations: z.object({ exportViaMcp: z.boolean() }) }).parse(textResult(await client.callTool({ name: 'assembly_capabilities' })))
    assert.equal(capability.protocolVersion, 2)
    assert.equal(capability.operations.exportViaMcp, false)
    assert.equal((await client.callTool({ name: 'assembly_edit', arguments: {} })).isError, true)
    const listed = textResult(await client.callTool({ name: 'assembly_list', arguments: { search: '1', limit: 1 } }))
    const summary = z.object({ total: z.number(), items: z.array(z.object({ id: z.string(), revision: z.number() })) }).parse(listed)
    assert.equal(summary.total, 1)
    assert.equal(summary.items[0]?.id, own.id)
    assert.deepEqual(textResult(await client.callTool({ name: 'assembly_list', arguments: { offset: 100 } })), { total: 1, items: [] })
    assert.deepEqual(assemblyDocumentSchema.parse(textResult(await client.callTool({ name: 'assembly_get', arguments: { id: own.id } }))), own)
    for (const id of [other.id, common.id, randomUUID()]) assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: other.id, projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_list', arguments: { projectId: null } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { id: own.id, expectedRevision: own.revision, content: emptyAssembly(), requestKey: 'readonly' } })).isError, true)
    assert.equal(app.assembly.get(own.id, app.projectId).revision, own.revision)
  } finally { await client?.close(); await app.close() }
})

test('排片 MCP 编排与声音绑定复用保存校验，幂等、修订冲突和历史引用保护生效', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const video = (await app.library.import({ projectId: app.projectId, categoryId: null, kind: 'video', tags: [], prompt: '门铃声', notes: '' }, [join(app.directory, 'video.mp4')]))[0]!
    const audio = (await app.library.import({ projectId: null, categoryId: null, kind: 'audio', tags: [], prompt: '', notes: '' }, [join(app.directory, 'doorbell.wav')]))[0]!
    const otherAudio = (await app.library.import({ projectId: app.otherProjectId, categoryId: null, kind: 'audio', tags: [], prompt: '', notes: '' }, [join(app.directory, 'private.wav')]))[0]!
    const content = emptyAssembly()
    const version = content.versions[0]!
    const clipId = randomUUID()
    version.clips.push({ id: clipId, assetId: video.id, title: '门口', sourceDuration: 8, inPoint: 1, outPoint: 7, originalAudio: true, prompt: video.prompt })
    version.sounds.push({ id: randomUUID(), clipId, kind: 'effect', title: '门铃', evidence: '门铃声', state: 'bound', assetId: audio.id, start: 1, duration: 1, gain: 0.8 })
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1, assemblyEnabled: true }, app.directory)
    client = await connect(app.server)
    const args = { id: null, expectedRevision: 0, content, requestKey: 'assembly-create' }
    const createdResponse = await client.callTool({ name: 'assembly_save', arguments: args })
    assert.equal(createdResponse.isError, undefined)
    const created = assemblyDocumentSchema.parse(textResult(createdResponse))
    assert.equal(created.versions[0]?.sounds[0]?.assetId, audio.id)
    assert.deepEqual(textResult(await client.callTool({ name: 'assembly_save', arguments: args })), textResult(createdResponse))
    assert.equal(app.assembly.list(app.projectId).length, 1)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...args, content: emptyAssembly('不同内容') } })).isError, true)
    const edit = { id: created.id, expectedRevision: created.revision, content: { ...content, title: '精剪工程' }, requestKey: 'assembly-edit' }
    const saved = assemblyDocumentSchema.parse(textResult(await client.callTool({ name: 'assembly_save', arguments: edit })))
    assert.equal(saved.revision, created.revision + 1)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, requestKey: 'stale-edit' } })).isError, true)
    assert.equal(app.assembly.get(created.id, app.projectId).title, '精剪工程')
    const wrong = structuredClone(content)
    wrong.versions[0]!.sounds[0]!.assetId = otherAudio.id
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, content: wrong, expectedRevision: saved.revision, requestKey: 'cross-asset' } })).isError, true)
    wrong.versions[0]!.sounds[0]!.assetId = video.id
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, content: wrong, expectedRevision: saved.revision, requestKey: 'wrong-kind' } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, projectId: app.otherProjectId, expectedRevision: saved.revision, requestKey: 'cross-project' } })).isError, true)
    const invalid = structuredClone(content)
    invalid.versions[0]!.clips[0]!.outPoint = 9
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, content: invalid, expectedRevision: saved.revision, requestKey: 'invalid-range' } })).isError, true)
    const manual = app.assembly.save({ id: saved.id, projectId: app.projectId, expectedRevision: saved.revision, content: emptyAssembly('手动新修订') })
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...edit, expectedRevision: saved.revision, requestKey: 'manual-conflict' } })).isError, true)
    assert.equal(app.assembly.get(saved.id, app.projectId).revision, manual.revision)
    assert.throws(() => app.library.remove(video.id), /排片引用/)
    assert.throws(() => app.library.remove(audio.id), /排片引用/)
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
    const names = (await client.listTools()).tools.filter((tool) => tool.name.startsWith('assembly_')).map((tool) => tool.name)
    assert.deepEqual(names.sort(), ['assembly_capabilities', 'assembly_edit', 'assembly_get', 'assembly_list', 'assembly_save'])
  } finally { await client?.close(); await app.close() }
})

test('结构化剪辑复用会话权限、修订和幂等，另存版本不覆盖原版', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const own = app.assembly.save({ id: null, projectId: app.projectId, expectedRevision: 0, content: emptyAssembly() })
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1, assemblyEnabled: true }, app.directory)
    client = await connect(app.server)
    const args = { id: own.id, expectedRevision: own.revision, versionId: own.activeVersionId, copyAs: '默片样式版', requestKey: 'structured-edit',
      operations: [{ kind: 'insert-title', position: 0, duration: 2, visual: { kind: 'title', text: '片头', font: 'song', size: 12, foreground: '#222222', background: '#aaaaaa', surface: 'paper' } }] }
    const response = await client.callTool({ name: 'assembly_edit', arguments: args })
    assert.equal(response.isError, undefined)
    const saved = assemblyDocumentSchema.parse(textResult(response))
    assert.equal(saved.revision, own.revision + 1)
    assert.equal(saved.versions[0]!.clips.length, 0)
    assert.equal(saved.versions[1]!.clips[0]!.visual!.surface, 'paper')
    assert.deepEqual(textResult(await client.callTool({ name: 'assembly_edit', arguments: args })), textResult(response))
    assert.equal((await client.callTool({ name: 'assembly_edit', arguments: { ...args, requestKey: 'stale' } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_edit', arguments: { ...args, requestKey: 'other-project', projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_edit', arguments: { ...args, requestKey: 'bad-transition', expectedRevision: saved.revision, versionId: saved.activeVersionId,
      operations: [{ kind: 'set-transition', clipId: saved.versions[1]!.clips[0]!.id, transition: { kind: 'wipe-left', duration: 1 } }] } })).isError, true)
    assert.equal(app.assembly.get(own.id, app.projectId).revision, saved.revision)
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { await client?.close(); await app.close() }
})

test('排片全项目授权必须显式归属，公共工程、项目删除和关闭撤权生效', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: true, minutes: -1, assemblyEnabled: true }, app.directory)
    client = await connect(app.server)
    const args = { id: null, expectedRevision: 0, content: emptyAssembly(), requestKey: 'missing-scope' }
    assert.equal((await client.callTool({ name: 'assembly_list' })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: args })).isError, true)
    const common = assemblyDocumentSchema.parse(textResult(await client.callTool({ name: 'assembly_save', arguments: { ...args, projectId: null, requestKey: 'public' } })))
    assert.equal(common.projectId, null)
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: common.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: common.id, projectId: null } })).isError, undefined)
    const other = assemblyDocumentSchema.parse(textResult(await client.callTool({ name: 'assembly_save', arguments: { ...args, projectId: app.otherProjectId, requestKey: 'other' } })))
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: other.id, projectId: app.projectId } })).isError, true)
    app.database.connection.prepare('INSERT INTO workspace_trash (id, kind, project_id, snapshot, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(app.otherProjectId, 'project', app.otherProjectId, '{}', new Date().toISOString())
    assert.equal((await client.callTool({ name: 'assembly_get', arguments: { id: other.id, projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'assembly_save', arguments: { ...args, id: other.id, projectId: app.otherProjectId, expectedRevision: other.revision, requestKey: 'deleted-project' } })).isError, true)
    const config = connection(app.server)
    await client.close(); client = undefined
    app.server.stop()
    assert.equal(app.server.status().assemblyEnabled, false)
    await assert.rejects(fetch(config.url, { method: 'POST', headers: { Authorization: config.authorization } }))
    assert.equal(app.assembly.list(null).length, 1)
  } finally { await client?.close(); await app.close() }
})

test('独立剧本库需单独授权，只读会话可检索和读取但不能保存', async () => {
  const app = await setup()
  let client: Client | undefined
  const id = randomUUID()
  app.scripts.save({ id, projectId: app.projectId, title: '循环·剧情稿', markdown: '# 男老人去世，男孩出生', expectedRevision: null })
  const other = app.scripts.save({ id: randomUUID(), projectId: app.otherProjectId, title: '其他剧情', markdown: '不能泄露', expectedRevision: null })
  const loose = app.scripts.save({ id: randomUUID(), title: '未归属剧情', markdown: '不能隐式读取', expectedRevision: null })
  try {
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: false, minutes: -1 }, '')
    assert.equal(app.server.status().scriptLibraryEnabled, false)
    client = await connect(app.server)
    assert.equal((await client.listTools()).tools.some(tool => tool.name.startsWith('script_library_')), false)
    assert.equal((await client.callTool({ name: 'script_library_get', arguments: { id } })).isError, true)
    await client.close(); client = undefined; app.server.stop()
    // 剧本单独启用，但不能超出单项目范围。
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, scriptLibraryEnabled: true }, '')
    client = await connect(app.server)
    const names = (await client.listTools()).tools.map(tool => tool.name)
    assert.ok(names.includes('script_library_list'))
    assert.ok(names.includes('script_library_get'))
    assert.equal(names.includes('script_library_save'), false)
    const listed = textResult(await client.callTool({ name: 'script_library_list', arguments: { search: '剧情' } }))
    assert.deepEqual(listed, { total: 1, items: app.scripts.list(app.projectId).map(({ markdown: _markdown, ...metadata }) => metadata) })
    assert.deepEqual(textResult(await client.callTool({ name: 'script_library_list', arguments: { offset: 100 } })), { total: 1, items: [] })
    const document = libraryDocumentSchema.parse(textResult(await client.callTool({ name: 'script_library_get', arguments: { id } })))
    assert.equal(document.markdown, '# 男老人去世，男孩出生')
    assert.equal((await client.callTool({ name: 'script_library_get', arguments: { id: other.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_get', arguments: { id: loose.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_list', arguments: { projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_get', arguments: { id: randomUUID() } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: { ...document, expectedRevision: 0, requestKey: 'read-only' } })).isError, true)
    assert.equal(app.scripts.list(app.projectId)[0]!.revision, 0)
    await client.close(); client = undefined; app.server.stop()
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: false, minutes: -1, scriptLibraryEnabled: true }, '')
    client = await connect(app.server)
    assert.equal((await client.callTool({ name: 'script_library_list' })).isError, true)
    const unassigned = z.object({ total: z.number() }).parse(textResult(await client.callTool({ name: 'script_library_list', arguments: { projectId: null } })))
    assert.equal(unassigned.total, 1)
    assert.equal(libraryDocumentSchema.parse(textResult(await client.callTool({ name: 'script_library_get', arguments: { id: other.id } }))).projectId, app.otherProjectId)
  } finally { await client?.close(); await app.close() }
})

test('旧 MCP 偏好升级默认不授权独立剧本库，缺少服务时拒绝开启该权限', async () => {
  const app = await setup()
  const unconfigured = new AssetMcpServer(app.library, 0)
  try {
    app.database.connection.prepare('INSERT INTO asset_mcp_preferences (singleton, data) VALUES (1, ?)')
      .run(JSON.stringify({ projectId: app.projectId, allProjects: false, writeEnabled: true, minutes: 60, importDirectory: app.directory }))
    const settings = new SettingsService(new SqlitePreferencesRepository(app.database.connection), {
      information: async () => ({ version: 'test', dataDirectory: app.directory, logsDirectory: app.directory, availableBytes: null }),
      openDirectory: async () => undefined
    })
    assert.equal(settings.mcpPreferences().scriptLibraryEnabled, false)
    assert.equal(settings.mcpPreferences().assemblyEnabled, false)
    await assert.rejects(unconfigured.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, scriptLibraryEnabled: true }, ''), /尚未配置/)
    await assert.rejects(unconfigured.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, assemblyEnabled: true }, ''), /尚未配置/)
    assert.equal(unconfigured.status().enabled, false)
  } finally { unconfigured.stop(); await app.close() }
})

test('独立剧本库保存复用修订校验和幂等，不复活已删除文档或提交任务', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1, scriptLibraryEnabled: true }, app.directory)
    client = await connect(app.server)
    const names = (await client.listTools()).tools.map(tool => tool.name)
    assert.equal(names.some(name => /delete|restore|submit|generate|account/.test(name)), false)
    const input = { id: randomUUID(), title: '循环·分镜稿', markdown: '# 分镜\n男老人离世，男孩诞生。', expectedRevision: null, requestKey: 'script-create' }
    const created = libraryDocumentSchema.parse(textResult(await client.callTool({ name: 'script_library_save', arguments: input })))
    assert.equal(created.revision, 0)
    assert.deepEqual(textResult(await client.callTool({ name: 'script_library_save', arguments: input })), created)
    assert.equal(app.scripts.list(app.projectId).length, 1)
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: { ...input, markdown: '不同内容' } })).isError, true)
    const updated = libraryDocumentSchema.parse(textResult(await client.callTool({ name: 'script_library_save', arguments: {
      ...input, markdown: '# 台词保留，环境声和配乐关闭', expectedRevision: 0, requestKey: 'script-update'
    } })))
    assert.equal(updated.revision, 1)
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: { ...input, projectId: app.otherProjectId, expectedRevision: 1, requestKey: 'wrong-project' } })).isError, true)
    const stale = { ...input, markdown: '旧修订覆盖', expectedRevision: 0, requestKey: 'script-stale' }
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: stale })).isError, true)
    assert.equal(app.scripts.list(app.projectId)[0]!.markdown, updated.markdown)
    app.scripts.remove({ id: input.id, projectId: app.projectId, expectedRevision: 1 })
    assert.equal((await client.callTool({ name: 'script_library_get', arguments: { id: input.id } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: { ...input, requestKey: 'no-resurrect' } })).isError, true)
    assert.equal((await client.callTool({ name: 'script_library_save', arguments: { ...input, expectedRevision: 2, requestKey: 'no-resurrect-update' } })).isError, true)
    const config = connection(app.server)
    await client.close(); client = undefined; app.server.stop()
    await assert.rejects(fetch(config.url, { method: 'POST', headers: { Authorization: config.authorization } }))
  } finally { await client?.close(); await app.close() }
})

test('不限时 MCP 真实握手、七工具读写、幂等、项目和目录隔离、关闭撤权', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    const status = await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    assert.equal(status.enabled, true)
    assert.equal(status.expiresAt, null)
    client = await connect(app.server)
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort()
    assert.deepEqual(tools, ['asset_categories', 'asset_category_save', 'asset_file_replace', 'asset_prompt_save', 'asset_update', 'assets_import', 'assets_list', 'assets_read_image', 'assets_resolve_path'])
    assert.equal(tools.some(name => /generat|submit|account|delete/.test(name)), false)
    const categoryResult = await client.callTool({ name: 'asset_category_save', arguments: { requestKey: 'category', id: null, name: 'MCP 分类' } })
    assert.equal(categoryResult.isError, undefined)
    const categories = z.array(z.object({ id: z.string(), name: z.string() })).parse(textResult(await client.callTool({ name: 'asset_categories' })))
    const metadata = { name: 'MCP 测试提示词', categoryId: categories[0]!.id, tags: ['测试'], prompt: '仅保存文本，不发起生成', notes: '' }
    const args = { ...metadata, requestKey: 'prompt' }
    const saved = z.object({ id: z.string(), updatedAt: z.string() }).parse(textResult(await client.callTool({ name: 'asset_prompt_save', arguments: args })))
    assert.deepEqual(textResult(await client.callTool({ name: 'asset_prompt_save', arguments: args })), textResult(await client.callTool({ name: 'asset_prompt_save', arguments: args })))
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...args, name: '冲突内容' } })).isError, true)
    const updated = await client.callTool({ name: 'asset_update', arguments: { ...metadata, id: saved.id, expectedUpdatedAt: saved.updatedAt, name: '已编辑', requestKey: 'update' } })
    assert.equal(updated.isError, undefined)
    const other = app.library.savePrompt({ ...metadata, categoryId: null, projectId: app.otherProjectId, name: '不可见' })
    const common = app.library.savePrompt({ ...metadata, categoryId: null, projectId: null, name: '公共素材' })
    const listed = listedSchema.parse(textResult(await client.callTool({ name: 'assets_list' })))
    assert.equal(listed.total, 2)
    assert.ok(listed.items.some(item => item.id === common.id))
    assert.ok(!listed.items.some(item => item.id === other.id))
    assert.equal((await client.callTool({ name: 'asset_update', arguments: { ...metadata, id: other.id, expectedUpdatedAt: other.updatedAt, requestKey: 'cross-project' } })).isError, true)
    const path = join(app.directory, 'fixture.png')
    await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const importArgs = { categoryId: null, kind: 'image', tags: [], prompt: '', notes: '', paths: [path], requestKey: 'import' }
    assert.equal((await client.callTool({ name: 'assets_import', arguments: importArgs })).isError, undefined)
    await client.callTool({ name: 'assets_import', arguments: importArgs })
    assert.equal(app.imports, 1)
    assert.equal((await client.callTool({ name: 'assets_import', arguments: { ...importArgs, requestKey: 'outside', paths: [join(app.directory, '..')] } })).isError, true)
    assert.equal((await client.callTool({ name: 'assets_import', arguments: { ...importArgs, requestKey: 'remote', paths: ['https://example.com/image.png'] } })).isError, true)
    const config = connection(app.server)
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const request = (headers: Record<string, string>) => fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: rpc })
    assert.equal((await request({})).status, 403)
    assert.equal((await request({ Authorization: 'Bearer invalid' })).status, 403)
    assert.equal((await request({ Authorization: config.authorization, Origin: 'https://example.com' })).status, 403)
    // fetch 会重写 Host，使用原生 HTTP 客户端实际发送恶意 Host。
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(config.url, { method: 'POST', headers: { Host: 'evil.example', Authorization: config.authorization,
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } }, response => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
      })
      req.once('error', reject)
      req.end(rpc)
    })
    assert.equal(badHostStatus, 403)
    const oldConfig = connection(app.server)
    app.server.stop()
    assert.equal(app.server.status().enabled, false)
    assert.throws(() => app.server.configuration(), /开启/)
    await assert.rejects(fetch(oldConfig.url, { method: 'POST', headers: { Authorization: oldConfig.authorization } }))
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { await client?.close(); await app.close() }
})

test('只读 MCP 只公开查询工具；重开连接保留固定令牌', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    const oldToken = connection(app.server).authorization
    app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: 5 }, '')
    assert.ok(Date.parse(app.server.status().expiresAt!) > Date.now())
    assert.equal(connection(app.server).authorization, oldToken)
    client = await connect(app.server)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['asset_categories', 'assets_list', 'assets_read_image', 'assets_resolve_path'])
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: {} })).isError, true)
  } finally { await client?.close(); await app.close() }
})

test('全项目授权查询所有有效项目，写入须指定归属，支持公共素材和后续新增项目', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    assert.equal(startAssetMcpSchema.safeParse({ projectId: null, allProjects: false, writeEnabled: false, minutes: -1 }).success, false)
    assert.equal(startAssetMcpSchema.safeParse({ projectId: app.projectId, allProjects: true, writeEnabled: false, minutes: -1 }).success, false)
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: true, minutes: -1 }, app.directory)
    assert.equal(app.server.status().allProjects, true)
    client = await connect(app.server)
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
      'asset_categories', 'asset_category_save', 'asset_file_replace', 'asset_prompt_save', 'asset_update',
      'assets_import', 'assets_list', 'assets_read_image', 'assets_resolve_path', 'projects_list'
    ])
    const projectList = z.array(z.object({ id: z.string(), name: z.string() })).parse(textResult(await client.callTool({ name: 'projects_list' })))
    assert.deepEqual(new Set(projectList.map(project => project.id)), new Set([app.projectId, app.otherProjectId]))
    const metadata = { name: '全项目提示词', categoryId: null, tags: [], prompt: '只是文本', notes: '' }
    for (const projectId of [app.projectId, app.otherProjectId, null]) {
      assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...metadata, projectId, requestKey: `save-${projectId}` } })).isError, undefined)
    }
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...metadata, requestKey: 'missing-project' } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...metadata, projectId: randomUUID(), requestKey: 'unknown-project' } })).isError, true)
    const list = async (projectId?: string | null) => listedSchema.parse(textResult(await client!.callTool({ name: 'assets_list', arguments: projectId === undefined ? {} : { projectId } })))
    assert.equal((await list()).total, 3)
    assert.equal((await list(app.projectId)).total, 1)
    assert.equal((await list(null)).total, 1)
    const publicAsset = app.library.list({ projectId: null })[0]!
    assert.equal((await client.callTool({ name: 'asset_update', arguments: { ...metadata, id: publicAsset.id,
      expectedUpdatedAt: publicAsset.updatedAt, name: '公共素材更新', requestKey: 'public-update' } })).isError, undefined)
    const path = join(app.directory, 'fixture.png')
    await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const imported = await client.callTool({ name: 'assets_import', arguments: { categoryId: null, kind: 'image', tags: [], prompt: '', notes: '',
      projectId: app.otherProjectId, paths: [path], requestKey: 'all-import' } })
    assert.equal(imported.isError, undefined)
    assert.equal(app.library.list({ projectId: app.otherProjectId, kind: 'image' }).length, 1)
    const newProjectId = randomUUID()
    new SqliteProjectRepository(app.database.connection).upsert({ id: newProjectId, name: '后来新增', sample: false }, 2)
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...metadata, projectId: newProjectId, requestKey: 'new-project' } })).isError, undefined)
    app.database.connection.prepare('INSERT INTO workspace_trash (id, kind, project_id, snapshot, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(app.otherProjectId, 'project', app.otherProjectId, '{}', new Date().toISOString())
    const projectsAfterDeletion = z.array(z.object({ id: z.string() })).parse(textResult(await client.callTool({ name: 'projects_list' })))
    assert.ok(!projectsAfterDeletion.some(project => project.id === app.otherProjectId))
    assert.equal((await list(app.otherProjectId)).total, 0)
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { ...metadata, projectId: app.otherProjectId, requestKey: 'deleted-project' } })).isError, true)
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { await client?.close(); await app.close() }
})

test('全项目只读不公开写入能力；单项目不能通过显式 projectId 扩权', async () => {
  const app = await setup()
  let client: Client | undefined
  try {
    await app.server.start({ projectId: null, allProjects: true, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['asset_categories', 'assets_list', 'assets_read_image', 'assets_resolve_path', 'projects_list'])
    await client.close()
    app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    assert.equal((await client.callTool({ name: 'assets_list', arguments: { projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'asset_prompt_save', arguments: { name: '越权', categoryId: null, tags: [], prompt: '文本', notes: '',
      projectId: app.otherProjectId, requestKey: 'escalate' } })).isError, true)
  } finally { await client?.close(); await app.close() }
})

test('已记住的导入目录不存在时拒绝开启，保留配置供用户更换目录', async () => {
  const app = await setup()
  try {
    const settings = new SettingsService(new SqlitePreferencesRepository(app.database.connection), {
      information: async () => ({ version: 'test', dataDirectory: app.directory, logsDirectory: app.directory, availableBytes: null }), openDirectory: async () => undefined
    })
    const preferences = { projectId: app.projectId, allProjects: false, writeEnabled: true, minutes: -1, importDirectory: join(app.directory, 'missing'), scriptLibraryEnabled: false, assemblyEnabled: false, imageGenerationEnabled: false, imageSubmissionEnabled: false }
    settings.saveMcpPreferences(preferences)
    await assert.rejects(app.server.start(preferences, preferences.importDirectory), /导入目录不可用/)
    assert.equal(app.server.status().enabled, false)
    assert.deepEqual(settings.mcpPreferences(), preferences)
    await app.server.start({ ...preferences, writeEnabled: false }, '')
    assert.equal(app.server.status().enabled, true)
  } finally { await app.close() }
})

test('MCP 范围、权限、时长和目录跨数据库重开保留，偏好不含令牌或启用状态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-mcp-preferences-'))
  const path = join(directory, 'test.sqlite')
  const environment = { information: async () => ({ version: 'test', dataDirectory: directory, logsDirectory: directory, availableBytes: null }), openDirectory: async () => undefined }
  let database = new WorkbenchDatabase(path)
  try {
    let settings = new SettingsService(new SqlitePreferencesRepository(database.connection), environment)
    assert.equal(settings.mcpPreferences().allProjects, false)
    assert.equal(settings.mcpPreferences().writeEnabled, false)
    const saved = { projectId: null, allProjects: true, writeEnabled: true, minutes: -1, importDirectory: directory, scriptLibraryEnabled: true, assemblyEnabled: true, imageGenerationEnabled: false, imageSubmissionEnabled: false }
    settings.saveMcpPreferences(saved)
    settings.save({ editorMode: 'edit', editorFontSize: 18, taskNotifications: false })
    assert.deepEqual(settings.mcpPreferences(), saved)
    assert.throws(() => settings.saveMcpPreferences({ ...saved, minutes: 0 }))
    database.close()
    database = new WorkbenchDatabase(path)
    settings = new SettingsService(new SqlitePreferencesRepository(database.connection), environment)
    assert.deepEqual(settings.mcpPreferences(), saved)
    assert.equal(settings.preferences().editorFontSize, 18)
    assert.deepEqual(Object.keys(settings.mcpPreferences()).sort(), ['allProjects', 'assemblyEnabled', 'imageGenerationEnabled', 'imageSubmissionEnabled', 'importDirectory', 'minutes', 'projectId', 'scriptLibraryEnabled', 'writeEnabled'])
  } finally { database.close(); await rm(directory, { recursive: true, force: true }) }
})

test('v11 升级增加独立 MCP 偏好表，不覆盖已有编辑偏好和剧本', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-mcp-migration-'))
  const path = join(directory, 'test.sqlite')
  let database = new WorkbenchDatabase(path)
  try {
    new SqlitePreferencesRepository(database.connection).write({ editorMode: 'preview', editorFontSize: 16, taskNotifications: false })
    const id = randomUUID()
    database.connection.prepare('INSERT INTO script_library (id, title, markdown, revision, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, '迁移保留', '# 原文', 3, new Date().toISOString())
    database.connection.exec(`DROP TABLE asset_mcp_preferences; DROP TABLE media_storage_settings;
      DROP INDEX script_library_project; ALTER TABLE script_library DROP COLUMN project_id;
      DROP INDEX asset_folders_root_name; DROP INDEX asset_folders_sibling_name;
      ALTER TABLE asset_categories DROP COLUMN project_id;
      CREATE UNIQUE INDEX asset_folders_root_name ON asset_categories(name) WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX asset_folders_sibling_name ON asset_categories(parent_id, name) WHERE parent_id IS NOT NULL;
      PRAGMA user_version = 11`)
    database.close()
    database = new WorkbenchDatabase(path)
    assert.equal(database.connection.prepare('PRAGMA user_version').get()?.user_version, 15)
    assert.deepEqual(new SqlitePreferencesRepository(database.connection).read(), { editorMode: 'preview', editorFontSize: 16, taskNotifications: false })
    assert.equal(database.connection.prepare('SELECT markdown FROM script_library WHERE id = ?').get(id)?.markdown, '# 原文')
    assert.equal(new SqlitePreferencesRepository(database.connection).readMcp(), null)
  } finally { database.close(); await rm(directory, { recursive: true, force: true }) }
})

test('视频草稿 MCP 创建编辑、修订冲突、引用去重、项目隔离、只读及零生成', async () => {
  const app = await setup(true)
  let client: Client | undefined
  const savedSchema = z.object({ revision: z.number(), draft: videoDraftSchema })
  const referencesSchema = z.array(z.object({ id: z.string(), assetId: z.string(), label: z.string() }))
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    assert.equal(tools.length, 14)
    assert.ok(!tools.some(name => /submit|generate|schedule|account/.test(name)))
    const list = () => client!.callTool({ name: 'video_drafts_list', arguments: { projectId: app.projectId } })
    const initial = z.object({ revision: z.number(), drafts: z.array(videoDraftSchema) }).parse(textResult(await list()))
    assert.equal(initial.drafts.length, 0)
    const args = { requestKey: 'draft-create', projectId: app.projectId, expectedRevision: initial.revision,
      draft: { id: null, title: 'MCP 测试草稿', description: '仅测试本地保存', prompt: '参考 <Picture 1>', duration: 8,
        aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'manual' } }
    const createdResponse = await client.callTool({ name: 'video_draft_save', arguments: args })
    assert.equal(createdResponse.isError, undefined)
    const created = savedSchema.parse(textResult(createdResponse))
    assert.equal(created.revision, initial.revision + 1)
    assert.deepEqual(textResult(await client.callTool({ name: 'video_draft_save', arguments: args })), textResult(createdResponse))
    assert.equal((await app.drafts.list(app.projectId)).drafts.length, 1)
    const changes = { ...args, requestKey: 'draft-edit', expectedRevision: created.revision, draft: { ...args.draft, id: created.draft.id, title: '已修改', duration: 10 } }
    const edited = savedSchema.parse(textResult(await client.callTool({ name: 'video_draft_save', arguments: changes })))
    assert.equal(edited.draft.duration, 10)
    assert.equal(edited.draft.promptDocument, '')
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: { ...changes, requestKey: 'stale-version' } })).isError, true)
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: { ...changes, requestKey: 'invalid-duration', draft: { ...changes.draft, duration: 99 } } })).isError, true)
    assert.equal((await client.callTool({ name: 'video_drafts_list', arguments: { projectId: app.otherProjectId } })).isError, true)
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: { ...changes, requestKey: 'cross-project', projectId: app.otherProjectId } })).isError, true)
    const image = (projectId: string | null) => app.library.import({ projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, [join(app.directory, 'reference.png')])
    const ownImage = (await image(app.projectId))[0]!
    const publicImage = (await image(null))[0]!
    const otherImage = (await image(app.otherProjectId))[0]!
    const attach = { projectId: app.projectId, draftId: created.draft.id, assetId: ownImage.id, requestKey: 'attach' }
    const attached = referencesSchema.parse(textResult(await client.callTool({ name: 'video_draft_reference_attach', arguments: attach })))
    assert.equal(attached[0]?.label, '<Picture 1>')
    const replacementImage = (await image(app.projectId))[0]!
    const replacementInput = { projectId: app.projectId, draftId: created.draft.id, id: attached[0]!.id,
      expectedAssetId: ownImage.id, assetId: replacementImage.id, expectedUpdatedAt: replacementImage.updatedAt, requestKey: 'reference-replace' }
    assert.equal((await client.callTool({ name: 'video_draft_reference_replace', arguments: { ...replacementInput, projectId: app.otherProjectId, requestKey: 'outside-replace' } })).isError, true)
    const replacedResponse = await client.callTool({ name: 'video_draft_reference_replace', arguments: replacementInput })
    assert.equal(replacedResponse.isError, undefined)
    assert.equal(referencesSchema.parse(textResult(replacedResponse))[0]?.label, '<Picture 1>')
    assert.equal(app.references.list(created.draft.id)[0]?.assetId, replacementImage.id)
    assert.deepEqual(textResult(await client.callTool({ name: 'video_draft_reference_replace', arguments: replacementInput })), textResult(replacedResponse))
    assert.equal((await client.callTool({ name: 'video_draft_reference_replace', arguments: { ...replacementInput, requestKey: 'stale-replace' } })).isError, true)
    await client.callTool({ name: 'video_draft_reference_replace', arguments: { ...replacementInput,
      expectedAssetId: replacementImage.id, assetId: ownImage.id, expectedUpdatedAt: ownImage.updatedAt, requestKey: 'reference-restore-original' } })
    await client.callTool({ name: 'video_draft_reference_attach', arguments: { ...attach, requestKey: 'attach-again' } })
    assert.equal(app.references.list(created.draft.id).length, 1)
    assert.equal((await client.callTool({ name: 'video_draft_reference_attach', arguments: { ...attach, assetId: otherImage.id, requestKey: 'other-image' } })).isError, true)
    assert.equal((await client.callTool({ name: 'video_draft_reference_attach', arguments: { ...attach, assetId: publicImage.id, requestKey: 'public-image' } })).isError, undefined)
    assert.equal((await client.callTool({ name: 'video_draft_reference_attach', arguments: { ...attach, draftId: randomUUID(), requestKey: 'missing-draft' } })).isError, true)
    const withReferences = z.object({ drafts: z.array(z.object({ references: referencesSchema })) }).parse(textResult(await list()))
    assert.equal(withReferences.drafts[0]?.references.length, 2)
    const detach = { projectId: app.projectId, draftId: created.draft.id, referenceId: attached[0]!.id, requestKey: 'detach' }
    assert.equal((await client.callTool({ name: 'video_draft_reference_detach', arguments: { ...detach, referenceId: randomUUID(), requestKey: 'wrong-reference' } })).isError, true)
    const detached = await client.callTool({ name: 'video_draft_reference_detach', arguments: detach })
    assert.equal(referencesSchema.parse(textResult(detached)).length, 1)
    assert.deepEqual(textResult(await client.callTool({ name: 'video_draft_reference_detach', arguments: detach })), textResult(detached))
    assert.equal(app.library.get(ownImage.id).id, ownImage.id)
    await app.workspace.remove({ projectId: app.projectId, id: created.draft.id, kind: 'video', expectedRevision: edited.revision })
    const revision = (await app.workspace.load()).revision
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: { ...changes, expectedRevision: revision, requestKey: 'deleted-draft' } })).isError, true)
    assert.equal((await client.callTool({ name: 'video_draft_reference_attach', arguments: { ...attach, requestKey: 'deleted-attach' } })).isError, true)
    await client.close()
    app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['asset_categories', 'assets_list', 'assets_read_image', 'assets_resolve_path', 'video_drafts_list', 'video_groups_list'])
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: args })).isError, true)
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { await client?.close(); await app.close() }
})

test('视频分组 MCP 查询、新建、重命名、草稿归组与权限修订校验', async () => {
  const app = await setup(true)
  let client: Client | undefined
  const groupSchema = z.object({ id: z.string().uuid(), name: z.string() })
  const listSchema = z.object({ revision: z.number(), groups: z.array(groupSchema) })
  const savedSchema = z.object({ revision: z.number(), group: groupSchema })
  try {
    await app.server.start({ projectId: app.projectId, writeEnabled: true, minutes: -1 }, app.directory)
    client = await connect(app.server)
    const initial = listSchema.parse(textResult(await client.callTool({ name: 'video_groups_list', arguments: { projectId: app.projectId } })))
    const args = { projectId: app.projectId, expectedRevision: initial.revision, id: null, name: ' 新片 ', requestKey: 'group-create' }
    const call = (input: typeof args | (Omit<typeof args, 'id'> & { id: string })) => client!.callTool({ name: 'video_group_save', arguments: input })
    const created = savedSchema.parse(textResult(await call(args)))
    assert.equal(created.group.name, '新片')
    assert.deepEqual(textResult(await call(args)), created)
    assert.equal((await call({ ...args, expectedRevision: created.revision, requestKey: 'duplicate' })).isError, true)
    assert.equal((await call({ ...args, name: '另一组', requestKey: 'stale' })).isError, true)
    assert.equal((await call({ ...args, expectedRevision: created.revision, id: randomUUID(), requestKey: 'foreign-group' })).isError, true)
    assert.equal((await call({ ...args, projectId: app.otherProjectId, requestKey: 'foreign-project' })).isError, true)
    const renamed = savedSchema.parse(textResult(await call({ ...args, id: created.group.id, name: '新片修订', expectedRevision: created.revision, requestKey: 'rename' })))
    const draft = { id: null, groupId: created.group.id, title: 'A', description: '', prompt: '本地提示词', duration: 8,
      aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto' }
    assert.equal((await client.callTool({ name: 'video_draft_save', arguments: { projectId: app.projectId, expectedRevision: renamed.revision, draft, requestKey: 'grouped-draft' } })).isError, undefined)
    const current = await app.drafts.list(app.projectId)
    assert.equal(current.drafts[0]?.groupId, created.group.id)
    assert.deepEqual(current.groups, [renamed.group])
    await assert.rejects(app.drafts.saveGroup({ projectId: app.projectId, expectedRevision: current.revision, id: null, name: '撤权' }, () => { throw new Error('撤权') }), /撤权/)
    assert.equal((await app.drafts.listGroups(app.projectId)).groups.length, 1)
    await client.close(); client = undefined; app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    client = await connect(app.server)
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'video_groups_list'))
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'video_group_save'))
    assert.equal((await call({ ...args, expectedRevision: current.revision, requestKey: 'readonly' })).isError, true)
    assert.equal(app.database.connection.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { await client?.close(); await app.close() }
})

test('视频草稿保存排队期间撤权阻断落库', async () => {
  const app = await setup(true)
  try {
    const current = await app.workspace.load()
    await assert.rejects(app.drafts.save({ projectId: app.projectId, expectedRevision: current.revision,
      draft: { id: null, title: '撤权测试', description: '', prompt: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'manual' }
    }, () => { throw new Error('授权已撤销') }), /授权已撤销/)
    assert.equal((await app.drafts.list(app.projectId)).drafts.length, 0)
    assert.equal((await app.workspace.load()).revision, current.revision)
  } finally { await app.close() }
})

test('排片媒体检查只读开放、隔离项目、返回真实时长和标准图片内容', async () => {
  let calls = 0
  const app = await setup(false, { async inspect(_path, _kind, times) {
    calls += 1
    return { duration: 5.125, width: 1080, height: 1920, frames: times.map(time => ({ time, data: 'aW1hZ2U=' })) }
  } })
  let client: Client | undefined
  try {
    const video = (projectId: string, title: string) => {
      const id = randomUUID()
      return app.library.registerGeneratedVideo({ id, projectId, title, prompt: '', jobId: randomUUID(), storedName: `${id}.mp4`, size: 10 })
    }
    const own = video(app.projectId, '本项目')
    const other = video(app.otherProjectId, '其他项目')
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, assemblyEnabled: true }, '')
    client = await connect(app.server)
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'assembly_inspect_media'))
    const response = await client.callTool({ name: 'assembly_inspect_media', arguments: { assetId: own.id, times: [0, 4] } })
    assert.equal(response.isError, undefined)
    const blocks = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(response.content)
    assert.deepEqual(JSON.parse(blocks.find(block => block.type === 'text')!.text!), { assetId: own.id, projectId: app.projectId, duration: 5.125, width: 1080, height: 1920,
      frames: [{ time: 0, mimeType: 'image/jpeg' }, { time: 4, mimeType: 'image/jpeg' }] })
    assert.equal((response.content as { type: string }[]).filter(item => item.type === 'image').length, 2)
    assert.equal((await client.callTool({ name: 'assembly_inspect_media', arguments: { assetId: other.id } })).isError, true)
    assert.equal(calls, 1)
    assert.equal((await client.callTool({ name: 'assembly_inspect_media', arguments: { assetId: own.id, times: Array(7).fill(0) } })).isError, true)
    assert.equal(calls, 1)
    await client.close(); app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1, assemblyEnabled: false }, '')
    client = await connect(app.server)
    assert.ok(!(await client.listTools()).tools.some(tool => tool.name === 'assembly_inspect_media'))
  } finally { await client?.close(); await app.close() }
})

test('虚拟时间推进验证不限时持续开放、定时会话到期自动关闭', async (context) => {
  const app = await setup()
  try {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: -1 }, '')
    context.mock.timers.tick(24 * 60 * 60 * 1000)
    assert.equal(app.server.status().enabled, true)
    assert.equal(app.server.status().expiresAt, null)
    app.server.stop()
    await app.server.start({ projectId: app.projectId, writeEnabled: false, minutes: 5 }, '')
    context.mock.timers.tick(5 * 60 * 1000 - 1)
    assert.equal(app.server.status().enabled, true)
    context.mock.timers.tick(1)
    assert.equal(app.server.status().enabled, false)
  } finally { context.mock.timers.reset(); await app.close() }
})
