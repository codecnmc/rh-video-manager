import test from 'node:test'
import assert from 'node:assert/strict'
import { VoiceService, type VoiceLibrary } from '../src/main/modules/voices/application/voice-service.ts'
import type { Asset } from '../src/shared/contracts/assets.ts'

test('项目音频复制为独立公共音色，源素材删除后仍可查询', async () => {
  const source: Asset = { id: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222',
    kind: 'audio', name: '原音频.wav', categoryId: null, tags: [], prompt: '', notes: '', size: 10, createdAt: 'now', updatedAt: 'now', archived: false }
  const rows = new Map<string, Asset>([[source.id, source]])
  const library: VoiceLibrary = {
    list: () => [...rows.values()].filter((asset) => asset.projectId === null),
    get: (id) => { const asset = rows.get(id); if (!asset) throw new Error('不存在'); return asset },
    media: () => ({ path: '/managed/source.wav' }),
    async import(input, paths, authorize) {
      authorize?.()
      assert.deepEqual(paths, ['/managed/source.wav'])
      const asset: Asset = { ...source, ...input, id: '33333333-3333-4333-8333-333333333333' }
      rows.set(asset.id, asset)
      return [asset]
    },
    update(input) { const asset = { ...rows.get(input.id)!, name: input.name, tags: input.tags }; rows.set(asset.id, asset); return asset }
  }
  const voices = new VoiceService(library)
  const voice = await voices.fromAsset({ assetId: source.id, expectedUpdatedAt: 'now', name: '角色音色' })
  assert.notEqual(voice.assetId, source.id)
  rows.delete(source.id)
  assert.equal(voices.list()[0]?.name, '角色音色')
  assert.equal(voices.get(voice.id).assetId, voice.assetId)
  const renamed = voices.rename({ id: voice.id, expectedUpdatedAt: voice.updatedAt, name: '新角色名称' })
  assert.equal(renamed.name, '新角色名称')
  assert.equal(renamed.assetId, voice.assetId)
  assert.equal(rows.size, 1)
  assert.throws(() => voices.remove({ id: voice.id, expectedUpdatedAt: 'old' }), /已更新/)
  voices.remove({ id: voice.id, expectedUpdatedAt: renamed.updatedAt })
  assert.equal(voices.list().length, 0)
  assert.equal(rows.size, 1)
  assert.equal(library.get(voice.assetId).name, '新角色名称')
  assert.equal(library.get(voice.assetId).archived, false)
})

test('音色创建拒绝变化的来源版本', async () => {
  const library = { get: () => ({ archived: false, kind: 'audio', updatedAt: 'new' }) } as unknown as VoiceLibrary
  await assert.rejects(new VoiceService(library).fromAsset({ assetId: '11111111-1111-4111-8111-111111111111', expectedUpdatedAt: 'old', name: '音色' }), /已变化/)
})
