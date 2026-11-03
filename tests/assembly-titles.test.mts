import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { assemblyClipSchema, assemblyVersionSchema, type AssemblyClip } from '../src/shared/contracts/assembly.ts'
import { insertTimelineClip, removeGeneratedClip, resizeGeneratedClip } from '../src/shared/assembly-insert.ts'
import { soundStart, timelineClips, totalDuration } from '../src/shared/assembly-timing.ts'
import { canvasFfmpegFilter, defaultTitleVisual, resolveAssemblyCanvas } from '../src/shared/assembly-visual.ts'
import { layoutTitle } from '../src/shared/title-layout.ts'
import { titleAss, subtitleFilter } from '../src/main/modules/assembly/adapters/ffmpeg-generated-visual.ts'
import { AssemblyService } from '../src/main/modules/assembly/application/assembly-service.ts'
import { AssemblyExportService } from '../src/main/modules/assembly/application/assembly-export-service.ts'
import { SqliteAssemblyRepository } from '../src/main/modules/assembly/adapters/sqlite-assembly-repository.ts'

function fixture() {
  return assemblyVersionSchema.parse({ id: randomUUID(), name: '初剪', sounds: [], clips: [0, 1].map(() => ({
    id: randomUUID(), assetId: randomUUID(), title: '人物视频', sourceDuration: 10, inPoint: 1, outPoint: 5, originalAudio: true, prompt: ''
  })) })
}
function card(duration = 2): AssemblyClip {
  return assemblyClipSchema.parse({ id: randomUUID(), assetId: null, title: '字幕卡', visual: { ...defaultTitleVisual, text: '听说伴君如伴虎' },
    inPoint: 0, outPoint: duration, sourceDuration: duration, originalAudio: false, prompt: '' })
}

test('字幕卡不伪造素材引用，旧视频仍可读取，拒绝混合来源与非法画布', () => {
  const title = card()
  assert.equal(title.assetId, null)
  assert.equal(fixture().clips[0]!.visual, undefined)
  assert.equal(assemblyClipSchema.safeParse({ ...title, assetId: randomUUID() }).success, false)
  assert.equal(assemblyClipSchema.safeParse({ ...title, originalAudio: true }).success, false)
  assert.equal(assemblyClipSchema.safeParse({ ...fixture().clips[0], assetId: null }).success, false)
  assert.equal(assemblyVersionSchema.safeParse({ ...fixture(), canvas: { width: 1279, height: 720, fit: 'cover' } }).success, false)
})

test('源片内插卡分割真实源区间，后续画面顺延，不重演动作或改动输入', () => {
  const version = fixture()
  const snapshot = JSON.stringify(version)
  const result = insertTimelineClip(version, card(), 2, randomUUID)
  assert.deepEqual(result.clips.map((clip) => [clip.inPoint, clip.outPoint]), [[1, 3], [0, 2], [3, 5], [1, 5]])
  assert.deepEqual(timelineClips(result).map(({ start, end }) => [start, end]), [[0, 2], [2, 4], [4, 6], [6, 10]])
  assert.equal(JSON.stringify(version), snapshot)
})

test('跨插入点的音频和字幕分割续接，源入点与后半片段绑定保留', () => {
  const version = fixture()
  version.sounds = [{ id: randomUUID(), clipId: version.clips[0]!.id, kind: 'effect', title: '衣料', evidence: '',
    state: 'bound', assetId: randomUUID(), start: 1, duration: 2, sourceIn: 5, sourceDuration: 10, gain: 1 }]
  version.captions = [{ id: randomUUID(), start: 1, end: 3, text: '原字幕' }, { id: randomUUID(), start: 5, end: 6, text: '后续字幕' }]
  const result = insertTimelineClip(version, card(), 2, randomUUID)
  assert.deepEqual(result.sounds.map((sound) => [soundStart(result, sound), sound.duration, sound.sourceIn]), [[1, 1, 5], [4, 1, 6]])
  assert.equal(result.sounds[1]!.clipId, result.clips[2]!.id)
  assert.deepEqual(result.captions!.map(({ start, end }) => [start, end]), [[1, 2], [4, 5], [7, 8]])
})

test('边界/空工程/非整帧末尾可插入；叠化和锁定轨道不静默修改', () => {
  const version = fixture()
  assert.equal(insertTimelineClip(version, card(), 4, randomUUID).clips.length, 3)
  assert.equal(insertTimelineClip({ ...version, clips: [] }, card(), 0, randomUUID).clips.length, 1)
  version.clips[1]!.outPoint = 4.125
  assert.equal(totalDuration(insertTimelineClip(version, card(), totalDuration(version), randomUUID)), totalDuration(version) + 2)
  version.clips[1]!.transition = { kind: 'dissolve', duration: 1 }
  assert.throws(() => insertTimelineClip(version, card(), 3.5, randomUUID), /转场区/)
  delete version.clips[1]!.transition
  const trackId = randomUUID()
  version.tracks = [{ id: trackId, kind: 'music', name: '音乐', locked: true, muted: false, solo: false, gain: 1 }]
  version.sounds = [{ id: randomUUID(), clipId: null, trackId, kind: 'music', title: '音乐', evidence: '', state: 'missing', assetId: null, start: 1, duration: 6, gain: 1 }]
  assert.throws(() => insertTimelineClip(version, card(), 2, randomUUID), /锁定音轨/)
})

test('改卡长与波纹删除共同重算后续位置，保留源片动作区间', () => {
  const version = fixture()
  version.captions = [{ id: randomUUID(), start: 5, end: 6, text: '后续字幕' }]
  const title = card()
  const inserted = insertTimelineClip(version, title, 2, randomUUID)
  const longer = resizeGeneratedClip(inserted, title.id, 3, randomUUID)
  assert.equal(totalDuration(longer), 11)
  assert.equal(longer.captions![0]!.start, 8)
  const shorter = resizeGeneratedClip(longer, title.id, 1, randomUUID)
  assert.equal(totalDuration(shorter), 9)
  assert.equal(shorter.captions![0]!.start, 6)
  const removed = removeGeneratedClip(shorter, title.id, randomUUID)
  assert.equal(totalDuration(removed), 8)
  assert.equal(removed.captions![0]!.start, 5)
  assert.deepEqual(removed.clips.slice(0, 2).map((clip) => [clip.inPoint, clip.outPoint]), [[1, 3], [3, 5]])
})

test('画布适配与文字分行共用参数，ASS居中宋体，拒绝超量文字', () => {
  const version = fixture()
  const source = { width: 1280, height: 736 }
  assert.deepEqual(resolveAssemblyCanvas(version, source), { ...source, fit: 'contain' })
  version.canvas = { width: 1280, height: 720, fit: 'cover' }
  const canvas = resolveAssemblyCanvas(version, source)
  assert.equal(canvas.height, 720)
  assert.match(canvasFfmpegFilter(canvas), /increase,crop=1280:720/)
  assert.match(canvasFfmpegFilter({ ...canvas, fit: 'contain' }), /decrease,pad=1280:720/)
  const visual = { ...defaultTitleVisual, text: '皇上有旨，请大将军\n去御书房商议军事。' }
  const layout = layoutTitle(visual, canvas)
  assert.equal(layout.fits, true)
  assert.match(titleAss(visual, canvas), /Style: Default,Noto Serif CJK SC/)
  assert.match(titleAss(visual, canvas), /去御书房商议军事。/)
  assert.match(subtitleFilter('D:\\temp\\title.ass'), /D\\:/)
  const title = card()
  title.visual!.text = '字'.repeat(2000)
  assert.equal(assemblyVersionSchema.safeParse({ ...version, clips: [title] }).success, false)
})

test('纯字幕卡工程可经SQLite保存回读与导出准备，无空素材引用', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE workspace_trash (id TEXT PRIMARY KEY)')
    const repository = new SqliteAssemblyRepository(db)
    const media = { get: () => { throw new Error('不应读取媒体') }, path: () => { throw new Error('不应读取磁盘素材') } }
    const service = new AssemblyService(repository, media, randomUUID)
    const version = { ...fixture(), clips: [card()], canvas: { width: 1280, height: 720, fit: 'contain' as const } }
    const document = service.save({ id: null, projectId: null, expectedRevision: 0,
      content: { title: '文字卡工程', episode: null, activeVersionId: version.id, versions: [version] } })
    assert.equal(service.get(document.id, null).versions[0]!.clips[0]!.visual!.kind, 'title')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assembly_asset_refs').get()!.n, 0)
    const plan = new AssemblyExportService(service, media).prepare({ id: document.id, projectId: null,
      expectedRevision: 1, versionId: version.id, requestId: randomUUID(), allowPendingSounds: false })
    assert.equal(plan.files.size, 0)
  } finally { db.close() }
})

test('开发和生产共用CSP允许受控本地协议和Blob，不启用安全绕过', async () => {
  const config = await readFile(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
  const connect = config.split('\n').find((line) => line.includes('connect-src'))!
  assert.match(connect, /workbench-asset: blob:/)
  assert.doesNotMatch(connect, /https?:|file:|unsafe|connect-src \*/)
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.match(main, /supportFetchAPI: true/)
  assert.doesNotMatch(main, /bypassCSP: true/)
})
