import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase, SqliteWorkspaceRepository } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteProjectRepository } from '../src/main/infrastructure/database/project-repository.ts'
import { SqliteScriptRepository } from '../src/main/infrastructure/database/script-repository.ts'
import { SqliteVideoDraftRepository } from '../src/main/infrastructure/database/video-repository.ts'
import { SqliteAssetRepository } from '../src/main/infrastructure/database/asset-repository.ts'
import { SqliteReferenceRepository } from '../src/main/infrastructure/database/reference-repository.ts'
import { ProjectService } from '../src/main/modules/projects/application/project-service.ts'
import { ScriptService } from '../src/main/modules/scripts/application/script-service.ts'
import { VideoService } from '../src/main/modules/video/application/video-service.ts'
import { LibraryService } from '../src/main/modules/assets/application/library-service.ts'
import { ReferenceService } from '../src/main/modules/assets/application/reference-service.ts'
import { WorkspaceService } from '../src/main/application/workspace-service.ts'
import { createWorkspace } from '../src/main/bootstrap/create-workspace.ts'
import { videoDraftSchema } from '../src/shared/contracts/video.ts'
import { workspaceSchema } from '../src/shared/contracts/workspace.ts'
import type { AssetFiles } from '../src/main/modules/assets/ports/library.ts'
import { pasteReferenceImagesSchema, pastedImageMaxBytes, type PastedImage } from '../src/shared/contracts/references.ts'

function setup() {
  const database = new WorkbenchDatabase(':memory:')
  const db = database.connection
  const projects = new ProjectService(new SqliteProjectRepository(db))
  const scripts = new ScriptService(new SqliteScriptRepository(db))
  const videos = new VideoService(new SqliteVideoDraftRepository(db))
  const workspace = new WorkspaceService(new SqliteWorkspaceRepository(db, projects, scripts, videos,
    (source, target, projectId) => references.copy(source, target, projectId)), createWorkspace)
  const discarded: string[] = []
  let imports = 0
  const imageBytes = new Map<string, Uint8Array>()
  const files: AssetFiles = {
    localPath: async () => { throw new Error('此测试不查询本地路径') },
    readImage: async (name) => ({ bytes: imageBytes.get(name) ?? new Uint8Array(10), mimeType: 'image/png' }),
    importImage: async (id, image) => {
      imports += 1
      if (image.name === 'fail.png') throw new Error('图片导入失败')
      imageBytes.set(`${id}.png`, image.bytes)
      return { storedName: `${id}.png`, name: image.name, size: image.bytes.byteLength }
    },
    import: async (id, path) => {
      imports += 1
      if (path === 'fail') throw new Error('导入失败')
      return { storedName: `${id}.png`, name: `${path}.png`, size: 10 }
    }, discard: async (name) => { discarded.push(name) }, reveal: () => undefined, resolve: (name) => `/assets/${name}`
  }
  const library = new LibraryService(new SqliteAssetRepository(db), files, randomUUID)
  const references = new ReferenceService(new SqliteReferenceRepository(db), library, randomUUID)
  return { database, db, workspace, library, references, discarded, get imports() { return imports } }
}

async function saveImageDraft(app: ReturnType<typeof setup>) {
  const initial = await app.workspace.load()
  const projectId = randomUUID()
  const draftId = randomUUID()
  await app.workspace.save({ expectedRevision: initial.revision, workspace: workspaceSchema.parse({ ...initial, projects: [{
    id: projectId, name: '粘贴图片项目', sample: false, episodes: [], videoDrafts: [{ id: draftId, title: '视频', description: '',
      prompt: '', promptDocument: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'default' }]
  }] }) })
  return { projectId, draftId }
}

let imageSequence = 0
// 编号、目录与替换测试使用不同内容；相同内容的复用由专门回归用例覆盖。
function freshImage(): PastedImage {
  return { name: 'clipboard.png', mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ++imageSequence]) }
}

test('替换视频草稿素材保留引用编号与提示词，拒绝旧绑定、跨类型、重复和过期素材', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const refs = await app.references.importImages(draftId, projectId, '视频', [freshImage(), freshImage()])
    const old = refs[0]!
    const replacement = (await app.library.importImages(projectId, '新图', [freshImage()], () => undefined))[0]!
    const input = { draftId, id: old.id, expectedAssetId: old.assetId, assetId: replacement.id, expectedUpdatedAt: replacement.updatedAt }
    const current = await app.workspace.load()
    current.projects[0]!.videoDrafts[0]!.prompt = '人物位于 <Picture 1> 中'
    await app.workspace.save({ expectedRevision: current.revision, workspace: current })
    const replaced = app.references.replace(input, projectId)
    assert.equal(replaced[0]?.id, old.id)
    assert.equal(replaced[0]?.label, old.label)
    assert.equal(replaced[0]?.assetId, replacement.id)
    assert.equal(app.library.get(old.assetId).id, old.assetId)
    assert.equal((await app.workspace.load()).projects[0]!.videoDrafts[0]!.prompt, '人物位于 <Picture 1> 中')
    assert.throws(() => app.references.replace(input, projectId), /引用已变化/)
    assert.throws(() => app.references.replace({ ...input, expectedAssetId: replacement.id, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, projectId), /未变更/)
    const duplicate = app.library.get(refs[1]!.assetId)
    assert.throws(() => app.references.replace({ ...input, expectedAssetId: replacement.id, assetId: duplicate.id, expectedUpdatedAt: duplicate.updatedAt }, projectId), /其他引用/)
    const video = (await app.library.import({ projectId, categoryId: null, kind: 'video', tags: [], prompt: '', notes: '' }, ['clip']))[0]!
    assert.throws(() => app.references.replace({ ...input, expectedAssetId: replacement.id, assetId: video.id, expectedUpdatedAt: video.updatedAt }, projectId), /同类型/)
    assert.throws(() => app.references.replace({ ...input, draftId: randomUUID(), expectedAssetId: replacement.id }, projectId), /引用已变化/)
    const foreignProject = randomUUID()
    const loaded = await app.workspace.load()
    loaded.projects.push({ id: foreignProject, name: '其他项目', sample: false, episodes: [], videoDrafts: [] })
    await app.workspace.save({ expectedRevision: loaded.revision, workspace: loaded })
    const foreign = (await app.library.import({ projectId: foreignProject, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, ['foreign']))[0]!
    assert.throws(() => app.references.replace({ ...input, expectedAssetId: replacement.id, assetId: foreign.id, expectedUpdatedAt: foreign.updatedAt }, projectId), /当前项目/)
  } finally { app.database.close() }
})

test('视频分组保存、复制及重新读取保留归属，拒绝跨项目归属和重复分组', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const current = await app.workspace.load()
    const groupId = randomUUID()
    const project = current.projects.find((item) => item.id === projectId)!
    project.videoGroups = [{ id: groupId, name: '第1集' }]
    project.videoDrafts[0]!.groupId = groupId
    const saved = await app.workspace.save({ expectedRevision: current.revision, workspace: current })
    assert.deepEqual((await app.workspace.load()).projects[0]!.videoGroups, project.videoGroups)
    const copied = await app.workspace.copyVideoDraft({ projectId, draftId, expectedRevision: saved.revision })
    assert.equal(copied.workspace.projects[0]!.videoDrafts.find((item) => item.id === copied.draftId)!.groupId, groupId)
    const foreign = structuredClone(copied.workspace)
    foreign.projects[0]!.videoDrafts[0]!.groupId = randomUUID()
    await assert.rejects(app.workspace.save({ expectedRevision: foreign.revision, workspace: foreign }), /分组不属于/)
    const duplicate = structuredClone(copied.workspace)
    duplicate.projects[0]!.videoGroups!.push({ id: groupId, name: '重复标识' })
    await assert.rejects(app.workspace.save({ expectedRevision: duplicate.revision, workspace: duplicate }), /标识重复/)
    duplicate.projects[0]!.videoGroups = [{ id: groupId, name: '第1集' }, { id: randomUUID(), name: '第1集' }]
    await assert.rejects(app.workspace.save({ expectedRevision: duplicate.revision, workspace: duplicate }), /名称重复/)
    const moved = structuredClone(copied.workspace)
    moved.projects[0]!.videoDrafts.forEach((item) => { delete item.groupId })
    await app.workspace.save({ expectedRevision: moved.revision, workspace: moved })
    assert.ok((await app.workspace.load()).projects[0]!.videoDrafts.every((item) => !item.groupId))
  } finally { app.database.close() }
})

test('草稿复制保留参数、富文本和引用编号空洞，不复制任务且可独立编辑', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const imported = await app.references.importImages(draftId, projectId, '视频', [freshImage(), freshImage()])
    app.references.detach(imported[0]!.id)
    const current = await app.workspace.load()
    const source = current.projects[0]!.videoDrafts[0]!
    source.prompt = '<Picture 2> 对比'
    source.promptDocument = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'promptReference', attrs: { label: '<Picture 2>' } }] }] })
    const saved = await app.workspace.save({ expectedRevision: current.revision, workspace: current })
    const result = await app.workspace.copyVideoDraft({ projectId, draftId, expectedRevision: saved.revision })
    const copied = result.workspace.projects[0]!.videoDrafts.find((item) => item.id === result.draftId)!
    assert.notEqual(copied.id, source.id)
    assert.equal(copied.title, '视频 副本')
    assert.equal(copied.prompt, source.prompt)
    assert.equal(copied.promptDocument, source.promptDocument)
    assert.equal(copied.duration, source.duration)
    assert.equal(result.workspace.revision, saved.revision + 1)
    const references = app.references.list(copied.id)
    assert.equal(references.length, 1)
    assert.equal(references[0]!.label, '<Picture 2>')
    assert.equal(references[0]!.assetId, imported[1]!.assetId)
    assert.notEqual(references[0]!.id, imported[1]!.id)
    app.references.detach(references[0]!.id)
    assert.equal(app.references.list(source.id).length, 1)
    await assert.rejects(app.workspace.copyVideoDraft({ projectId, draftId, expectedRevision: saved.revision }), /更新/)
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM generation_jobs').get()?.count, 0)
  } finally { app.database.close() }
})

test('引用不可复制时回滚草稿和修订，不留下空副本', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const [reference] = await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    app.library.archive(reference!.assetId, true)
    const before = await app.workspace.load()
    await assert.rejects(app.workspace.copyVideoDraft({ projectId, draftId, expectedRevision: before.revision }), /不可用/)
    const after = await app.workspace.load()
    assert.equal(after.revision, before.revision)
    assert.equal(after.projects[0]!.videoDrafts.length, 1)
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM video_drafts').get()?.count, 1)
  } finally { app.database.close() }
})

test('文件夹支持多级、同级重名校验、移动和空目录删除，拒绝循环嵌套', () => {
  const app = setup()
  try {
    const rootId = randomUUID(), childId = randomUUID(), otherId = randomUUID()
    const repository = new SqliteAssetRepository(app.db)
    repository.saveCategory({ id: rootId, name: '角色', parentId: null, projectId: null })
    repository.saveCategory({ id: otherId, name: '场景', parentId: null, projectId: null })
    app.library.saveCategory({ id: null, name: '主角', parentId: rootId })
    const child = app.library.categories().find((item) => item.parentId === rootId)!
    repository.saveCategory({ id: childId, name: '主角', parentId: otherId, projectId: null })
    assert.throws(() => app.library.saveCategory({ id: null, name: '主角', parentId: rootId }), /同级/)
    assert.throws(() => app.library.saveCategory({ id: rootId, name: '角色', parentId: child.id }), /自身或子文件夹/)
    assert.throws(() => app.library.saveCategory({ id: child.id, name: '主角', parentId: child.id }), /自身或子文件夹/)
    assert.throws(() => app.library.saveCategory({ id: child.id, name: '主角', parentId: randomUUID() }), /不存在/)
    assert.throws(() => app.library.removeCategory(rootId), /子文件夹/)
    app.library.saveCategory({ id: child.id, name: '演员' })
    assert.equal(app.library.categories().find((item) => item.id === child.id)?.parentId, rootId)
    app.library.saveCategory({ id: child.id, name: '演员', parentId: otherId })
    app.library.removeCategory(rootId)
    assert.equal(app.library.categories().some((item) => item.id === rootId), false)
    assert.equal(app.library.categories().find((item) => item.id === child.id)?.parentId, otherId)
  } finally { app.database.close() }
})

test('粘贴图片自动归入草稿文件夹，改名和移动后仍保留同一绑定，移动素材不改文件', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const result = await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    const repository = new SqliteAssetRepository(app.db)
    const folder = repository.draftCategory(draftId)!
    assert.equal(folder.name, '视频')
    assert.equal(app.library.get(result[0]!.assetId).categoryId, folder.id)
    app.library.saveCategory({ id: null, name: '整理', projectId })
    const parent = app.library.categories().find((item) => item.name === '整理')!
    app.library.saveCategory({ id: folder.id, name: '自定义', parentId: parent.id })
    await app.references.importImages(draftId, projectId, '视频新名', [freshImage()])
    assert.equal(repository.draftCategory(draftId)?.id, folder.id)
    assert.equal(repository.draftCategory(draftId)?.name, '自定义')
    assert.equal(app.library.list({ categoryId: folder.id }).length, 2)
    const before = repository.get(result[0]!.assetId)
    app.library.update({ ...before.asset, categoryId: parent.id, expectedUpdatedAt: before.asset.updatedAt })
    assert.equal(repository.get(before.asset.id).storedName, before.storedName)
    assert.equal(app.references.list(draftId).length, 2)
    assert.throws(() => app.library.removeCategory(folder.id), /仍有素材/)
    app.library.archive(app.references.list(draftId)[1]!.assetId, true)
    assert.throws(() => app.library.removeCategory(folder.id), /包含已归档/)
  } finally { app.database.close() }
})

test('同名草稿独立文件夹，不接管旧同名分类，失败批次不留下空目录', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    app.library.saveCategory({ id: null, name: '视频', projectId })
    const existing = app.library.categories()[0]!
    await assert.rejects(app.references.importImages(draftId, projectId, '视频', [freshImage(), { ...freshImage(), name: 'fail.png' }]))
    assert.equal(app.library.categories().length, 1)
    await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    const current = await app.workspace.load()
    const secondId = randomUUID()
    const project = current.projects.find((item) => item.id === projectId)!
    await app.workspace.save({ expectedRevision: current.revision, workspace: { ...current, projects: [{ ...project,
      videoDrafts: [...project.videoDrafts, { ...project.videoDrafts[0]!, id: secondId }] }] } })
    await app.references.importImages(secondId, projectId, '视频', [freshImage()])
    const repository = new SqliteAssetRepository(app.db)
    assert.equal(repository.draftCategory(draftId)?.name, '视频 (2)')
    assert.equal(repository.draftCategory(secondId)?.name, '视频 (3)')
    assert.notEqual(repository.draftCategory(draftId)?.id, existing.id)
    assert.notEqual(repository.draftCategory(draftId)?.id, repository.draftCategory(secondId)?.id)
    const before = app.library.categories().length
    await assert.rejects(app.library.importImages(projectId, '不存在', [freshImage()], () => undefined, randomUUID()), /视频草稿不存在/)
    assert.equal(app.library.categories().length, before)
  } finally { app.database.close() }
})

test('清空附件后重新粘贴从 Picture 1 开始，历史关联不删除或复活', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const previous = await app.references.importImages(draftId, projectId, '视频', [freshImage(), freshImage()])
    for (const reference of previous) app.references.detach(reference.id)
    assert.deepEqual(app.references.list(draftId), [])
    const current = await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    assert.equal(current[0]?.label, '<Picture 1>')
    assert.equal(previous.some((reference) => reference.id === current[0]?.id), false)
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM draft_references WHERE removed_at IS NOT NULL').get()?.count, 2)
    assert.equal(app.library.list({ projectId }).length, 3)
    const reloaded = new ReferenceService(new SqliteReferenceRepository(app.db), app.library, randomUUID)
    assert.deepEqual(reloaded.list(draftId), current)
  } finally { app.database.close() }
})

test('新增附件复用空闲编号但不重排有效标签，媒体类型和不同草稿独立编号', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const previous = await app.references.importImages(draftId, projectId, '视频', [freshImage(), freshImage(), freshImage()])
    app.references.detach(previous[1]!.id)
    const current = await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    assert.equal(current.find((reference) => reference.id === previous[0]!.id)?.label, '<Picture 1>')
    assert.equal(current.find((reference) => reference.id === previous[2]!.id)?.label, '<Picture 3>')
    assert.equal(current[2]?.label, '<Picture 2>')
    const audio = (await app.library.import({ projectId, categoryId: null, kind: 'audio', tags: [], prompt: '', notes: '' }, ['audio']))[0]!
    const audioReferences = app.references.attach(draftId, projectId, audio.id)
    assert.equal(audioReferences.find((reference) => reference.kind === 'audio')?.label, '<Audio 1>')
    const repository = new SqliteReferenceRepository(app.db)
    assert.equal(repository.nextOrdinal(randomUUID(), 'image'), 1)
    assert.equal(repository.nextOrdinal(draftId, 'video'), 1)
    assert.equal(repository.nextOrdinal(draftId, 'image'), 4)
    assert.deepEqual(app.references.attach(draftId, projectId, current[0]!.assetId), audioReferences)
  } finally { app.database.close() }
})

test('粘贴图片批量进入项目素材并关联草稿，重读保留附件与独立引用编号', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const result = await app.references.importImages(draftId, projectId, '视频', [freshImage(), { ...freshImage(), name: 'second.png' }])
    assert.deepEqual(result.map((reference) => reference.label), ['<Picture 1>', '<Picture 2>'])
    assert.equal(app.library.list({ projectId, kind: 'image' }).length, 2)
    const reloaded = new ReferenceService(new SqliteReferenceRepository(app.db), app.library, randomUUID)
    assert.deepEqual(reloaded.list(draftId), result)
    assert.equal(app.library.get(result[0]!.assetId).name, '视频-图片-001.png')
    assert.equal((await app.workspace.load()).projects[0]?.videoDrafts[0]?.prompt, '')
    await app.references.importImages(draftId, projectId, '视频', Array.from({ length: 7 }, () => freshImage()))
    const imports = app.imports
    await assert.rejects(app.references.importImages(draftId, projectId, '视频', [freshImage()]), /数量超过/)
    assert.equal(app.imports, imports)
    assert.equal(reloaded.list(draftId).length, 9)
  } finally { app.database.close() }
})

test('粘贴图片批次失败或写入前容量变化时清理文件，不留下部分素材与附件', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    await assert.rejects(app.references.importImages(draftId, projectId, '视频', [freshImage(), { ...freshImage(), name: 'fail.png' }]), /图片导入失败/)
    assert.equal(app.library.list().length, 0)
    assert.equal(app.references.list(draftId).length, 0)
    assert.equal(app.discarded.length, 1)
    const before = app.imports
    await assert.rejects(app.library.importImages(projectId, '视频', [freshImage()], () => {
      if (app.imports > before) throw new Error('容量已变化')
    }), /容量已变化/)
    assert.equal(app.library.list().length, 0)
    assert.equal(app.discarded.length, 2)
  } finally { app.database.close() }
})

test('粘贴图片 IPC 拒绝空批次、过多图片、非二进制数据、超限图片及非受支持格式', () => {
  const input = { draftId: randomUUID(), images: [freshImage()] }
  assert.equal(pasteReferenceImagesSchema.safeParse(input).success, true)
  for (const images of [[], Array.from({ length: 10 }, () => freshImage()),
    [{ ...freshImage(), bytes: [] }], [{ ...freshImage(), bytes: new Uint8Array() }],
    [{ ...freshImage(), bytes: new Uint8Array(pastedImageMaxBytes + 1) }], [{ ...freshImage(), mimeType: 'image/svg+xml' }]]) {
    assert.equal(pasteReferenceImagesSchema.safeParse({ ...input, images }).success, false)
  }
})

test('粘贴图片按视频名连续命名，标签复用不回退名称编号，归档和软删除名称仍占号', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const images: PastedImage[] = [freshImage(),
      { name: 'image.png', mimeType: 'image/jpeg', bytes: new Uint8Array([255, 216, 255]) },
      { name: 'image.png', mimeType: 'image/webp', bytes: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]) }]
    const first = await app.references.importImages(draftId, projectId, '视频', images)
    assert.deepEqual(first.map((reference) => reference.name), ['视频-图片-001.png', '视频-图片-002.jpg', '视频-图片-003.webp'])
    for (const reference of first) app.references.detach(reference.id)
    app.library.archive(first[0]!.assetId, true)
    app.library.remove(first[1]!.assetId)
    const reloaded = new ReferenceService(new SqliteReferenceRepository(app.db), app.library, randomUUID)
    const next = await reloaded.importImages(draftId, projectId, '视频', [freshImage()])
    assert.equal(next[0]?.label, '<Picture 1>')
    assert.equal(next[0]?.name, '视频-图片-004.png')
    assert.equal(app.library.get(next[0]!.assetId).name, next[0]?.name)
  } finally { app.database.close() }
})

test('同项目同名视频避开已有名称，改用新视频名不重命名旧素材，普通导入保持原名', async () => {
  const app = setup()
  try {
    const { projectId, draftId } = await saveImageDraft(app)
    const existing = (await app.library.import({ projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, ['source']))[0]!
    assert.equal(existing.name, 'source.png')
    app.library.update({ ...existing, name: '视频-图片-009.JPG', expectedUpdatedAt: existing.updatedAt })
    const first = await app.references.importImages(draftId, projectId, '视频', [freshImage()])
    assert.equal(first[0]?.name, '视频-图片-010.png')
    const next = await app.references.importImages(draftId, projectId, '片尾', [freshImage()])
    assert.deepEqual(next.map((reference) => reference.name), ['视频-图片-010.png', '片尾-图片-001.png'])
    assert.equal(app.library.get(existing.id).name, '视频-图片-009.JPG')
    const current = await app.workspace.load()
    const otherProjectId = randomUUID()
    await app.workspace.save({ expectedRevision: current.revision, workspace: { ...current, projects: [...current.projects, {
      id: otherProjectId, name: '其他项目', sample: false, episodes: [], videoDrafts: []
    }] } })
    const otherProject = await app.library.importImages(otherProjectId, '视频', [freshImage()], () => undefined)
    assert.equal(otherProject[0]?.name, '视频-图片-001.png')
  } finally { app.database.close() }
})

test('同名图片的并发批次按顺序分配唯一名称', async () => {
  const app = setup()
  try {
    const { projectId } = await saveImageDraft(app)
    const [first, second] = await Promise.all([
      app.library.importImages(projectId, '首幕', [freshImage(), freshImage()], () => undefined),
      app.library.importImages(projectId, '首幕', [freshImage(), freshImage()], () => undefined)
    ])
    assert.deepEqual([...first, ...second].map((asset) => asset.name), [
      '首幕-图片-001.png', '首幕-图片-002.png', '首幕-图片-003.png', '首幕-图片-004.png'
    ])
  } finally { app.database.close() }
})

test('图片名称清理非法文件名字符并限制长度，命名失败清理本批文件', async () => {
  const app = setup()
  try {
    const { projectId } = await saveImageDraft(app)
    const sanitized = await app.library.importImages(projectId, '  首幕:/开场*?  ', [freshImage()], () => undefined)
    assert.equal(sanitized[0]?.name, '首幕__开场__-图片-001.png')
    const long = await app.library.importImages(projectId, `${'长'.repeat(119)}\uD83D\uDE00`, [freshImage()], () => undefined)
    assert.equal(long[0]!.name.length <= 150, true)
    assert.equal(/[\uD800-\uDBFF]-图片/.test(long[0]!.name), false)
    const reserved = app.library.savePrompt({ projectId, categoryId: null, tags: [], prompt: '保留', notes: '', name: '视频-图片-9007199254740991.png' })
    const before = app.library.list({ projectId }).length
    await assert.rejects(app.library.importImages(projectId, '视频', [freshImage()], () => undefined), /序号已达上限/)
    assert.equal(app.library.list({ projectId }).length, before)
    assert.equal(app.library.get(reserved.id).name, reserved.name)
    assert.equal(app.discarded.length, 1)
  } finally { app.database.close() }
})

test('没有分集或剧本也可保存项目级视频草稿，重读仍保留富文本', async () => {
  const app = setup()
  try {
    const initial = await app.workspace.load()
    const id = randomUUID()
    const draft = videoDraftSchema.parse({ id: randomUUID(), title: '独立视频', description: '', prompt: '用户提示词',
      promptDocument: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto' })
    await app.workspace.save({ expectedRevision: initial.revision, workspace: workspaceSchema.parse({ ...initial,
      projects: [{ id, name: '项目', sample: false, episodes: [], videoDrafts: [draft] }] }) })
    const saved = await app.workspace.load()
    assert.deepEqual(saved.projects[0]?.episodes, [])
    assert.equal(saved.projects[0]?.videoDrafts[0]?.prompt, draft.prompt)
    assert.equal(saved.projects[0]?.videoDrafts[0]?.instanceMode, 'auto')
    assert.equal(saved.projects[0]?.videoDrafts[0]?.instance, 'plus')
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM shots').get()?.count, 0)
  } finally { app.database.close() }
})

test('素材分类、搜索、归档及引用不依赖剧本；拒绝跨项目和旧版本覆盖', async () => {
  const app = setup()
  try {
    const initial = await app.workspace.load()
    const projectId = randomUUID()
    const draftId = randomUUID()
    await app.workspace.save({ expectedRevision: initial.revision, workspace: workspaceSchema.parse({ ...initial, projects: [{
      id: projectId, name: '项目', sample: false, episodes: [], videoDrafts: [{ id: draftId, title: '视频', description: '',
        prompt: '', promptDocument: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'default' }]
    }] }) })
    const category = app.library.saveCategory({ id: null, name: '角色', projectId })[0]!
    assert.throws(() => app.library.saveCategory({ id: null, name: '角色', projectId }), /已存在/)
    const image = (await app.library.import({ projectId, categoryId: category.id, tags: ['主角'], prompt: '图片提示词', notes: '', kind: 'image' }, ['role']))[0]!
    assert.equal(app.library.list({ projectId, search: '主角' }).length, 1)
    assert.equal(app.library.list({ projectId, search: '图片提示词' }).length, 1)
    assert.throws(() => app.references.attach(draftId, randomUUID(), image.id), /其他项目/)
    const ref = app.references.attach(draftId, projectId, image.id)[0]!
    assert.equal(ref.assetId, image.id)
    assert.equal(ref.label, '<Picture 1>')
    app.library.archive(image.id, true)
    assert.equal(app.library.list({ projectId }).length, 0)
    assert.equal(app.references.list(draftId)[0]?.assetId, image.id)
    assert.throws(() => app.library.removeCategory(category.id), /仍有素材/)
    assert.throws(() => app.library.update({ ...image, expectedUpdatedAt: 'old', name: '覆盖' }), /已被其他/)
    app.library.archive(image.id, false)
    assert.equal(app.library.list({ projectId }).length, 1)
    const prompt = app.library.savePrompt({ projectId, categoryId: category.id, name: '独立提示词', tags: [], prompt: '内容', notes: '' })
    assert.throws(() => app.references.attach(draftId, projectId, prompt.id), /不作为媒体引用/)
  } finally { app.database.close() }
})

test('批量导入失败或授权撤销时清理本批文件，不留下部分素材记录', async () => {
  const app = setup()
  try {
    const input = { projectId: null, categoryId: null, tags: [], prompt: '', notes: '', kind: 'image' as const }
    await assert.rejects(app.library.import(input, ['first', 'fail']))
    assert.equal(app.discarded.length, 1)
    assert.equal(app.library.list().length, 0)
    await assert.rejects(app.library.import(input, ['second'], () => { if (app.imports >= 3) throw new Error('授权已撤销') }))
    assert.equal(app.library.list().length, 0)
    assert.equal(app.discarded.length, 2)
    assert.throws(() => app.library.savePrompt({ ...input, name: '空提示词', prompt: '  ' }), /不能为空/)
  } finally { app.database.close() }
})

test('删除草稿、分集和项目时保留底层记录，旧修订不能覆盖删除', async () => {
  const app = setup()
  try {
    const initial = await app.workspace.load()
    const projectId = randomUUID()
    const draftId = randomUUID()
    const episodeId = randomUUID()
    const saved = await app.workspace.save({ expectedRevision: initial.revision, workspace: workspaceSchema.parse({ ...initial,
      projects: [{ id: projectId, name: '待删除项目', sample: false, episodes: [{ id: episodeId, title: '剧本', script: '保留原文' }],
        videoDrafts: [{ id: draftId, title: '视频', description: '', prompt: '', promptDocument: '', duration: 8,
          aspectRatio: '16:9', resolution: '720P', instance: 'default' }] }]
    }) })
    const category = app.library.saveCategory({ id: null, name: '可删除分类', projectId })[0]!
    const image = (await app.library.import({ projectId, categoryId: category.id, kind: 'image', tags: [], prompt: '', notes: '' }, ['picture']))[0]!
    app.references.attach(draftId, projectId, image.id)
    assert.throws(() => app.library.remove(image.id), /仍被视频草稿引用/)
    await assert.rejects(app.workspace.remove({ expectedRevision: saved.revision, kind: 'video', projectId: randomUUID(), id: draftId }), /不存在/)
    const afterDraft = await app.workspace.remove({ expectedRevision: saved.revision, kind: 'video', projectId, id: draftId })
    assert.equal(afterDraft.projects[0]?.videoDrafts.length, 0)
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM video_drafts').get()?.count, 1)
    await assert.rejects(app.workspace.save({ expectedRevision: saved.revision, workspace: saved }), /重新载入/)
    app.library.remove(image.id)
    assert.equal(app.library.list({ projectId }).length, 0)
    assert.throws(() => app.library.get(image.id), /不存在/)
    assert.equal(app.discarded.length, 0)
    app.library.removeCategory(category.id)
    const afterEpisode = await app.workspace.remove({ expectedRevision: afterDraft.revision, kind: 'episode', projectId, id: episodeId })
    assert.equal(afterEpisode.projects[0]?.episodes.length, 0)
    const asset = app.library.savePrompt({ projectId, categoryId: null, name: '项目提示词', tags: [], prompt: '内容', notes: '' })
    const removed = await app.workspace.remove({ expectedRevision: afterEpisode.revision, kind: 'project', projectId, id: projectId })
    assert.equal(removed.projects.length, 0)
    assert.equal(app.library.list().length, 0)
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count, 1)
    assert.throws(() => app.library.update({ ...asset, expectedUpdatedAt: asset.updatedAt }), /不存在/)
    await assert.rejects(app.library.import({ projectId, categoryId: null, kind: 'image', tags: [], prompt: '', notes: '' }, ['late']), /已删除/)
  } finally { app.database.close() }
})
