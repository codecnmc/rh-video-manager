import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { AssemblyService } from '../src/main/modules/assembly/application/assembly-service.ts'
import { SqliteAssemblyRepository } from '../src/main/modules/assembly/adapters/sqlite-assembly-repository.ts'
import { assemblyContentSchema, assemblyDocumentSchema, assemblySoundSchema } from '../src/shared/contracts/assembly.ts'
import type { Asset } from '../src/shared/contracts/assets.ts'
import { AssemblyExportService } from '../src/main/modules/assembly/application/assembly-export-service.ts'
import { defaultAssemblyExportOptions, type AssemblyRenderProgress } from '../src/shared/contracts/assembly-export.ts'
import { timelineClips, locateTimelinePosition, reorderClips } from '../src/renderer/src/features/assembly/assembly-state.ts'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE workspace_trash (id TEXT PRIMARY KEY)')
  const projectId = randomUUID()
  db.prepare('INSERT INTO projects VALUES (?)').run(projectId)
  const asset: Asset = { id: randomUUID(), projectId, categoryId: null, kind: 'video', name: '视频.mp4', size: 100,
    tags: [], prompt: '门铃声', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false }
  const repository = new SqliteAssemblyRepository(db)
  const service = new AssemblyService(repository, { get: (id) => { assert.equal(id, asset.id); return asset } }, randomUUID)
  const versionId = randomUUID()
  const content = assemblyContentSchema.parse({ title: '初剪工程', episode: 1, activeVersionId: versionId, versions: [{
    id: versionId, name: '初剪', clips: [{ id: randomUUID(), assetId: asset.id, title: '门口', sourceDuration: 8,
      inPoint: 1, outPoint: 7, prompt: asset.prompt, originalAudio: true }], sounds: []
  }] })
  return { db, projectId, asset, repository, service, content }
}

test('调色随剪辑版本保存和回读，旧版本不受影响，拒绝超范围值', () => {
  const f = fixture()
  try {
    const original = f.content.versions[0]!
    const color = { brightness: 0, contrast: 0.99, saturation: 0.97, temperature: -0.01, tint: 0 }
    const graded = { ...original, id: randomUUID(), name: '校色版', clips: original.clips.map((clip) => ({ ...clip, color })) }
    const saved = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0,
      content: { ...f.content, activeVersionId: graded.id, versions: [original, graded] } })
    const loaded = f.service.get(saved.id, f.projectId)
    assert.equal(loaded.versions[0]!.clips[0]!.color, undefined)
    assert.deepEqual(loaded.versions[1]!.clips[0]!.color, color)
    assert.equal(assemblyContentSchema.safeParse({ ...f.content, versions: [{ ...graded, clips: [{ ...graded.clips[0], color: { ...color, contrast: 100 } }] }] }).success, false)
  } finally { f.db.close() }
})

test('拖动排序支持首尾插入，不更改裁切、原片和片段声音绑定', () => {
  const f = fixture()
  try {
    const version = f.content.versions[0]!
    const first = version.clips[0]!
    const second = { ...first, id: randomUUID(), title: '第二段' }
    const third = { ...first, id: randomUUID(), title: '第三段' }
    const original = { ...version, clips: [first, second, third] }
    const moved = reorderClips(original, first.id, third.id, true)
    assert.deepEqual(moved.clips.map((clip) => clip.id), [second.id, third.id, first.id])
    assert.equal(moved.clips[2], first)
    assert.equal(moved.sounds, original.sounds)
    assert.deepEqual(original.clips, [first, second, third])
    assert.deepEqual(reorderClips(moved, first.id, second.id, false).clips, original.clips)
    assert.equal(reorderClips(original, first.id, first.id, false), original)
    assert.equal(reorderClips(original, 'unknown', third.id, true), original)
  } finally { f.db.close() }
})

test('排片工程按项目隔离，重复修订拒绝覆盖且历史仍保留', () => {
  const f = fixture()
  try {
    const first = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content })
    assert.equal(assemblyDocumentSchema.parse(first).revision, 1)
    assert.equal(f.service.list(f.projectId).length, 1)
    assert.deepEqual(f.service.list(null), [])
    const second = f.service.save({ id: first.id, projectId: f.projectId, expectedRevision: 1, content: { ...f.content, title: '精剪工程' } })
    assert.equal(second.revision, 2)
    assert.throws(() => f.service.save({ id: first.id, projectId: f.projectId, expectedRevision: 1, content: f.content }), /已被其他窗口更新/)
    assert.equal(f.service.list(f.projectId)[0]?.title, '精剪工程')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assembly_history').get()?.n, 2)
  } finally { f.db.close() }
})

test('解除当前片段后仍保护历史引用；删除所属项目后隐藏且不能写回', () => {
  const f = fixture()
  try {
    const first = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content })
    const empty = { ...f.content, versions: f.content.versions.map((version) => ({ ...version, clips: [] })) }
    f.service.save({ id: first.id, projectId: f.projectId, expectedRevision: 1, content: empty })
    assert.equal(f.service.references(f.asset.id), true)
    f.db.prepare('INSERT INTO workspace_trash VALUES (?)').run(f.projectId)
    assert.deepEqual(f.service.list(f.projectId), [])
    assert.throws(() => f.service.save({ id: first.id, projectId: f.projectId, expectedRevision: 2, content: empty }), /已删除/)
  } finally { f.db.close() }
})

test('拒绝跨项目媒体和错误类型，不落入工程表', () => {
  const f = fixture()
  try {
    f.asset.projectId = randomUUID()
    assert.throws(() => f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content }), /项目归属/)
    f.asset.projectId = f.projectId
    f.asset.kind = 'audio'
    assert.throws(() => f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content }), /素材类型/)
    assert.deepEqual(f.service.list(f.projectId), [])
  } finally { f.db.close() }
})

test('校验裁切边界、声音绑定和已删除片段的声音引用', () => {
  const f = fixture()
  try {
    const version = f.content.versions[0]!
    const clip = version.clips[0]!
    assert.equal(assemblyContentSchema.safeParse({ ...f.content, versions: [{ ...version, clips: [{ ...clip, outPoint: 9 }] }] }).success, false)
    const sound = { id: randomUUID(), clipId: null, kind: 'voice', title: '角色台词', state: 'bound', assetId: null, evidence: '', start: 0, duration: 1, gain: 1 }
    assert.equal(assemblySoundSchema.safeParse(sound).success, false)
    assert.equal(assemblyContentSchema.safeParse({ ...f.content, versions: [{ ...version, sounds: [{ ...sound, clipId: randomUUID(), state: 'review' }] }] }).success, false)
  } finally { f.db.close() }
})

test('时间轴按裁切后时长定位，边界进入下一段，末尾和越界保持正确原片位置', () => {
  const f = fixture()
  try {
    const version = f.content.versions[0]!
    const first = version.clips[0]!
    const entries = timelineClips({ ...version, clips: [first, { ...first, id: randomUUID(), inPoint: 2, outPoint: 5 }] })
    assert.equal(entries[1]?.start, 6)
    assert.deepEqual(locateTimelinePosition(entries, 6), { position: 6, index: 1, sourceTime: 2 })
    assert.deepEqual(locateTimelinePosition(entries, 8), { position: 8, index: 1, sourceTime: 4 })
    assert.deepEqual(locateTimelinePosition(entries, 100), { position: 9, index: 1, sourceTime: 5 })
    assert.deepEqual(locateTimelinePosition(entries, -1), { position: 0, index: 0, sourceTime: 1 })
    assert.deepEqual(locateTimelinePosition([], 2), { position: 0, index: 0, sourceTime: 0 })
  } finally { f.db.close() }
})

test('导出只读取指定项目的最新修订，待补声音须明确确认，不改变工程', async () => {
  const f = fixture()
  try {
    const version = f.content.versions[0]!
    const content = { ...f.content, versions: [{ ...version, sounds: [assemblySoundSchema.parse({ id: randomUUID(), clipId: null,
      kind: 'music', title: '待补音乐', evidence: '', state: 'missing', assetId: null, start: 0, duration: 6, gain: 1 })] }] }
    const document = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content })
    const exporter = new AssemblyExportService(f.service, { get: () => f.asset, path: () => 'managed.mp4' })
    const request = { id: document.id, projectId: f.projectId, expectedRevision: 1, versionId: version.id, requestId: randomUUID(), allowPendingSounds: false }
    assert.throws(() => exporter.prepare(request), /待处理声音/)
    const allowed = { ...request, allowPendingSounds: true }
    assert.throws(() => exporter.prepare({ ...allowed, expectedRevision: 2 }), /已更新/)
    assert.throws(() => exporter.prepare({ ...allowed, projectId: randomUUID() }), /不存在/)
    let called = false
    await exporter.export(allowed, 'result.mp4', { async render(plan, target) {
      called = true
      assert.equal(target, 'result.mp4')
      assert.equal(plan.files.get(f.asset.id), 'managed.mp4')
      assert.equal(plan.version.clips[0]?.inPoint, 1)
    } }, new AbortController().signal)
    assert.equal(called, true)
    assert.equal(f.service.get(document.id, f.projectId).revision, 1)
    f.asset.projectId = randomUUID()
    assert.throws(() => exporter.prepare(allowed), /项目归属/)
  } finally { f.db.close() }
})

test('已取消导出不启动合成器', async () => {
  const f = fixture()
  try {
    const document = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content })
    const exporter = new AssemblyExportService(f.service, { get: () => f.asset, path: () => 'managed.mp4' })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(exporter.export({ id: document.id, projectId: f.projectId, expectedRevision: 1,
      versionId: document.activeVersionId, requestId: randomUUID(), allowPendingSounds: false }, 'result.mp4', {
      async render() { assert.fail('不应启动合成器') }
    }, controller.signal))
  } finally { f.db.close() }
})

test('导出参数和进度通过公共端口传递，不改写工程修订与画布', async () => {
  const f = fixture()
  try {
    const document = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: f.content })
    const exporter = new AssemblyExportService(f.service, { get: () => f.asset, path: () => 'managed.mp4' })
    const request = { id: document.id, projectId: f.projectId, expectedRevision: document.revision,
      versionId: document.activeVersionId, requestId: randomUUID(), allowPendingSounds: false }
    assert.equal(exporter.prepare(request).options, undefined)
    const options = { ...defaultAssemblyExportOptions, resolution: '720p' as const, crf: 23 }
    const updates: AssemblyRenderProgress[] = []
    await exporter.export({ ...request, options }, 'result.mp4', { async render(plan, _target, _signal, report) {
      assert.deepEqual(plan.options, options)
      plan.version.clips[0]!.inPoint = 2
      report?.({ stage: 'rendering', percent: 10, stagePercent: 20, detail: '处理片段' })
    } }, new AbortController().signal, (progress) => updates.push(progress))
    assert.equal(updates.length, 1)
    assert.equal(updates[0]!.percent, 10)
    assert.deepEqual(f.service.get(document.id, f.projectId), document)
  } finally { f.db.close() }
})

test('字幕、多音轨和从视频解链接的声音随 SQLite 修订保存，原视频引用仍受保护', () => {
  const f = fixture()
  try {
    const version = f.content.versions[0]!
    const track = { id: randomUUID(), name: '原片对白', kind: 'voice' as const, muted: false, solo: false, locked: false, gain: 0.8 }
    const edited = { ...version, tracks: [track], frameRate: 25, burnCaptions: true,
      captions: [{ id: randomUUID(), start: 0, end: 2, text: '字幕原文' }],
      sounds: [assemblySoundSchema.parse({ id: randomUUID(), clipId: null, trackId: track.id, sourceKind: 'video', assetId: f.asset.id,
        kind: 'voice', title: '对白', evidence: '', state: 'bound', start: 0, duration: 2, sourceIn: 1, sourceDuration: 8, gain: 1, fadeIn: 0.1, fadeOut: 0.1 })] }
    const saved = f.service.save({ id: null, projectId: f.projectId, expectedRevision: 0, content: { ...f.content, versions: [edited] } })
    const loaded = f.service.get(saved.id, f.projectId)
    assert.deepEqual(loaded.versions[0], edited)
    assert.equal(f.service.references(f.asset.id), true)
    const plan = new AssemblyExportService(f.service, { get: () => f.asset, path: () => 'managed.mp4' }).prepare({ id: saved.id, projectId: f.projectId,
      expectedRevision: saved.revision, versionId: version.id, requestId: randomUUID(), allowPendingSounds: false })
    assert.equal(plan.files.get(f.asset.id), 'managed.mp4')
    assert.equal(plan.version.sounds[0]!.sourceKind, 'video')
    assert.equal(assemblyContentSchema.safeParse({ ...f.content, versions: [{ ...edited, tracks: [] }] }).success, false)
  } finally { f.db.close() }
})
