import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteAssetRepository } from '../src/main/infrastructure/database/asset-repository.ts'
import { LibraryService } from '../src/main/modules/assets/application/library-service.ts'
import type { AssetFiles } from '../src/main/modules/assets/ports/library.ts'
import type { PastedImage } from '../src/shared/contracts/references.ts'
import { canDropFolder } from '../src/renderer/src/features/assets/use-library-drag.ts'

function setup() {
  const database = new WorkbenchDatabase(':memory:')
  const discarded: string[] = []
  const imageBytes = new Map<string, Uint8Array>()
  const files: AssetFiles = {
    localPath: async () => { throw new Error('此测试不查询本地路径') },
    readImage: async (name) => ({ bytes: imageBytes.get(name) ?? new Uint8Array(8), mimeType: 'image/png' }),
    import: async (id, path) => ({ storedName: `${id}.png`, name: path, size: 8 }),
    importImage: async (id, image) => {
      if (image.name === 'fail.png') throw new Error('导入失败')
      imageBytes.set(`${id}.png`, image.bytes)
      return { storedName: `${id}.png`, name: image.name, size: image.bytes.byteLength }
    },
    discard: async (name) => { discarded.push(name) }, reveal: () => undefined, resolve: (name) => name
  }
  const library = new LibraryService(new SqliteAssetRepository(database.connection), files, randomUUID)
  const folder = (name: string) => library.saveCategory({ id: null, name, parentId: null }).find((item) => item.name === name)!.id
  return { database, library, folder, discarded }
}
const image: PastedImage = { name: 'clipboard.png', mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }

test('粘贴按内容去重：同批、并发和改名后仍复用，归档不自动恢复', async () => {
  const app = setup()
  try {
    const input = { projectId: null, categoryId: null, images: [image, { ...image, name: '改名.png' }] }
    const [first, second] = await Promise.all([app.library.paste(input), app.library.paste(input)])
    assert.equal(new Set([...first, ...second].map((asset) => asset.id)).size, 1)
    assert.equal(app.library.list().length, 1)
    assert.equal(app.discarded.length, 3)
    const asset = first[0]!
    app.library.update({ ...asset, name: '自定义名称.png', expectedUpdatedAt: asset.updatedAt })
    const repeated = await app.library.paste(input)
    assert.ok(repeated.every((item) => item.id === asset.id && item.name === '自定义名称.png'))
    app.library.archive(asset.id, true)
    const fresh = await app.library.paste(input)
    assert.notEqual(fresh[0]!.id, asset.id)
    assert.equal(fresh[0]!.id, fresh[1]!.id)
    assert.equal(app.library.list({ archived: true }).length, 1)
  } finally { app.database.close() }
})

test('素材选择器按明确项目范围查询，公共和当前项目均不混入其他项目的素材与目录', async () => {
  const app = setup()
  try {
    const projectId = randomUUID()
    const otherId = randomUUID()
    for (const [index, id] of [projectId, otherId].entries()) {
      app.database.connection.prepare('INSERT INTO projects (id, name, sample, sort_order) VALUES (?, ?, ?, ?)').run(id, `项目${index}`, 0, index)
    }
    for (const scope of [null, projectId, otherId]) {
      const folder = app.library.saveCategory({ id: null, name: '同名目录', parentId: null, projectId: scope })
        .find((item) => item.projectId === scope && item.name === '同名目录')!
      await app.library.import({ projectId: scope, categoryId: folder.id, kind: 'image', tags: [], prompt: '', notes: '' }, ['reference.png'])
    }
    for (const scope of [null, projectId]) {
      const assets = app.library.list({ projectId: scope })
      const folders = app.library.categories(scope)
      assert.equal(assets.length, 1)
      assert.equal(folders.length, 1)
      assert.ok(assets.every((asset) => asset.projectId === scope))
      assert.ok(folders.every((folder) => folder.projectId === scope))
      assert.equal(assets[0]!.categoryId, folders[0]!.id)
    }
  } finally { app.database.close() }
})

test('文件夹拖动拒绝自身、子目录及原目录，允许移动到根目录', () => {
  const parent = { id: randomUUID(), name: '父目录', parentId: null, projectId: null }
  const child = { id: randomUUID(), name: '子目录', parentId: parent.id, projectId: null }
  const other = { id: randomUUID(), name: '其他目录', parentId: null, projectId: null }
  const categories = [parent, child, other]
  assert.equal(canDropFolder(categories, parent, parent.id), false)
  assert.equal(canDropFolder(categories, parent, child.id), false)
  assert.equal(canDropFolder(categories, child, parent.id), false)
  assert.equal(canDropFolder(categories, child, null), true)
  assert.equal(canDropFolder(categories, parent, other.id), true)
})

test('成片登记按受管文件标识幂等，保留用户后续重命名与移动', () => {
  const app = setup()
  try {
    const projectId = randomUUID()
    app.database.connection.prepare('INSERT INTO projects (id, name, sample, sort_order) VALUES (?, ?, ?, ?)').run(projectId, '成片项目', 0, 0)
    const id = randomUUID()
    const input = { id, projectId, title: '成片', prompt: '原始任务提示词', jobId: randomUUID(), storedName: `${id}.mp4`, size: 128 }
    const asset = app.library.registerGeneratedVideo(input)
    app.library.update({ ...asset, name: '手动命名.mp4', expectedUpdatedAt: asset.updatedAt })
    const existing = app.library.registerGeneratedVideo(input)
    assert.equal(existing.name, '手动命名.mp4')
    assert.equal(app.library.list({ projectId }).length, 1)
    assert.equal(app.library.categories().filter((folder) => folder.name === '最终成片').length, 1)
  } finally { app.database.close() }
})

test('素材库粘贴进入当前文件夹，无当前文件夹时复用粘贴导入目录', async () => {
  const app = setup()
  try {
    const target = app.folder('参考图片')
    const current = await app.library.paste({ projectId: null, categoryId: target, images: [image] })
    assert.equal(current[0]!.categoryId, target)
    const first = await app.library.paste({ projectId: null, categoryId: null, images: [image] })
    const second = await app.library.paste({ projectId: null, categoryId: null, images: [image] })
    assert.equal(first[0]!.categoryId, second[0]!.categoryId)
    assert.equal(first[0]!.id, current[0]!.id)
    assert.equal(first[0]!.id, second[0]!.id)
    assert.equal(app.library.list().length, 1)
    assert.equal(app.library.categories().filter((item) => item.name === '粘贴导入').length, 1)
    assert.equal(app.library.list({ categoryId: null }).length, 0)
  } finally { app.database.close() }
})

test('批量移动校验所有修订号，任意冲突都不移动其余素材', async () => {
  const app = setup()
  try {
    const target = app.folder('目标目录')
    const assets = await app.library.paste({ projectId: null, categoryId: null, images: [image, { ...image, bytes: new Uint8Array([...image.bytes, 1]) }] })
    const request = assets.map((asset) => ({ id: asset.id, expectedUpdatedAt: asset.updatedAt }))
    app.library.update({ ...assets[1]!, notes: '其他窗口更新', expectedUpdatedAt: assets[1]!.updatedAt })
    assert.throws(() => app.library.move({ categoryId: target, assets: request }), /更新/)
    assert.equal(app.library.get(assets[0]!.id).categoryId, assets[0]!.categoryId)
    const fresh = assets.map((asset) => app.library.get(asset.id))
    app.library.move({ categoryId: target, assets: fresh.map((asset) => ({ id: asset.id, expectedUpdatedAt: asset.updatedAt })) })
    assert.equal(app.library.list({ categoryId: target }).length, 2)
  } finally { app.database.close() }
})

test('拒绝重复素材与不存在的目标文件夹', async () => {
  const app = setup()
  try {
    const [asset] = await app.library.paste({ projectId: null, categoryId: null, images: [image] })
    const item = { id: asset!.id, expectedUpdatedAt: asset!.updatedAt }
    assert.throws(() => app.library.move({ categoryId: null, assets: [item, item] }), /重复/)
    assert.throws(() => app.library.move({ categoryId: randomUUID(), assets: [item] }), /不存在/)
  } finally { app.database.close() }
})

test('粘贴中途失败清理本批文件，不保存部分素材', async () => {
  const app = setup()
  try {
    await assert.rejects(app.library.paste({ projectId: null, categoryId: null, images: [image, { ...image, name: 'fail.png' }] }), /失败/)
    assert.equal(app.library.list().length, 0)
    assert.equal(app.discarded.length, 1)
  } finally { app.database.close() }
})

test('项目和公共文件夹独立，同名目录互不冲突，跨项目写入与移动被拒绝', async () => {
  const app = setup()
  try {
    const first = randomUUID(), second = randomUUID()
    for (const projectId of [first, second]) app.database.connection.prepare('INSERT INTO projects (id, name, sample, sort_order) VALUES (?, ?, 0, 0)').run(projectId, projectId)
    const create = (projectId: string | null) => {
      app.library.saveCategory({ id: null, name: '角色', projectId })
      return app.library.categories(projectId)[0]!
    }
    const a = create(first), b = create(second), common = create(null)
    assert.deepEqual(app.library.categories(first).map((folder) => folder.id), [a.id])
    assert.deepEqual(app.library.categories(second).map((folder) => folder.id), [b.id])
    assert.deepEqual(app.library.categories(null).map((folder) => folder.id), [common.id])
    assert.throws(() => app.library.saveCategory({ id: null, name: '角色', projectId: first }), /同级/)
    assert.throws(() => app.library.moveCategory(a.id, b.id), /该项目|归属/)
    assert.throws(() => app.library.saveCategory({ id: a.id, name: '修改归属', projectId: second }), /归属/)
    assert.equal(canDropFolder([a, b], a, b.id), false)
    await assert.rejects(app.library.import({ projectId: first, categoryId: b.id, kind: 'image', tags: [], prompt: '', notes: '' }, ['wrong.png']), /该项目/)
    assert.throws(() => app.library.savePrompt({ projectId: first, categoryId: common.id, name: '错误分类', tags: [], prompt: '内容', notes: '' }), /该项目/)
    const [asset] = await app.library.paste({ projectId: first, categoryId: a.id, images: [image] })
    assert.throws(() => app.library.move({ categoryId: b.id, assets: [{ id: asset!.id, expectedUpdatedAt: asset!.updatedAt }] }), /该项目/)
    assert.throws(() => app.library.update({ ...asset!, categoryId: b.id, expectedUpdatedAt: asset!.updatedAt }), /该项目/)
    assert.equal(app.library.get(asset!.id).categoryId, a.id)
    const repository = new SqliteAssetRepository(app.database.connection)
    assert.throws(() => repository.save([{ asset: { ...asset!, id: randomUUID(), categoryId: b.id }, storedName: null }]), /该项目/)
    const firstPaste = await app.library.paste({ projectId: first, categoryId: null, images: [image] })
    const secondPaste = await app.library.paste({ projectId: second, categoryId: null, images: [image] })
    assert.notEqual(firstPaste[0]!.categoryId, secondPaste[0]!.categoryId)
    app.database.connection.prepare('INSERT INTO workspace_trash (id, kind, project_id, snapshot, deleted_at) VALUES (?, ?, ?, ?, ?)').run(first, 'project', first, '{}', new Date().toISOString())
    assert.equal(app.library.categories().some((folder) => folder.projectId === first), false)
  } finally { app.database.close() }
})
