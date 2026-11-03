import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { imageAccountSchema, imageNodeSchema } from '../src/shared/contracts/image-generation.ts'
import { ProtocolImageGateway } from '../src/main/modules/image-generation/adapters/image-gateway.ts'
import { OpenAiImageProtocol } from '../src/main/modules/image-generation/adapters/openai-image-protocol.ts'
import type { ImageOutputStore, ImageProtocol } from '../src/main/modules/image-generation/ports/image-generation.ts'

test('历史账号默认原协议；新增协议只路由生成，共用结果归档', async () => {
  const account = imageAccountSchema.parse({ id: randomUUID(), revision: 1, name: '账号', baseUrl: 'https://provider.example.com',
    model: 'model', accountGroup: 'group', maxConcurrency: 1, enabled: true, stopped: false })
  const node = imageNodeSchema.parse({ id: randomUUID(), boardId: randomUUID(), projectId: null, revision: 1,
    title: '任务', prompt: '一张图片', size: '1280x720', accountId: account.id, references: [], status: 'draft',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), submittedAt: null,
    accountSnapshot: null, assetId: null, review: 'pending', error: '' })
  const generated: string[] = []
  const archived: string[] = []
  const protocol = (id: string): ImageProtocol => ({
    capabilities: { id, execution: 'synchronous', sizes: ['1280x720'], maxReferences: 0, progress: 'phase' },
    validate(_account, input) { if (input.references.length) throw new Error('不支持参考图') },
    async generate(_account, _key, _node, _paths, _signal, sending) { generated.push(id); sending(); return { b64_json: 'result' } }
  })
  const store: ImageOutputStore = {
    async diagnoseOutput() { return { kind: 'inline', downloadOrigin: null, sameServiceOrigin: false, network: 'not_needed', fakeIpAllowed: false } },
    async saveOutput(id) { archived.push(id); return { storedName: `${id}.png`, size: 8 } }
  }
  const gateway = new ProtocolImageGateway([protocol('openai-images'), protocol('another-protocol')], store)
  const signal = new AbortController().signal
  let sends = 0
  await gateway.generate(account, 'not-a-real-key', node, [], signal, () => sends++)
  const output = await gateway.generate({ ...account, protocol: 'another-protocol' }, 'not-a-real-key', node, [], signal, () => sends++)
  await gateway.saveOutput(node.id, output, signal, account.baseUrl)
  assert.deepEqual(generated, ['openai-images', 'another-protocol'])
  assert.deepEqual(archived, [node.id])
  assert.equal(sends, 2)
  assert.throws(() => gateway.validate({ ...account, protocol: 'missing' }, node), /未安装/)
  assert.throws(() => gateway.generate({ ...account, protocol: 'missing' }, '', node, [], signal, () => sends++), /未安装/)
  assert.equal(sends, 2)
  assert.throws(() => new ProtocolImageGateway([protocol('duplicate'), protocol('duplicate')], store), /重复/)

  // 下载恢复仅依赖缓存和来源快照，移除原生成协议仍不影响已有结果归档。
  const recovery = new ProtocolImageGateway([], store)
  await recovery.saveOutput(node.id, output, signal, account.baseUrl)
  assert.equal(archived.length, 2)
  assert.equal((await recovery.diagnoseOutput(output, account.baseUrl)).kind, 'inline')
  const capabilities = gateway.protocols()
  capabilities[0]!.sizes = []
  assert.deepEqual(gateway.protocols()[0]!.sizes, ['1280x720'])
})

test('OpenAI 图片适配器只声明真实同步和阶段能力，不声称有远端百分比', () => {
  const protocol = new OpenAiImageProtocol()
  assert.equal(protocol.capabilities.id, 'openai-images')
  assert.equal(protocol.capabilities.execution, 'synchronous')
  assert.equal(protocol.capabilities.progress, 'phase')
  assert.equal(protocol.capabilities.maxReferences, 16)
})
