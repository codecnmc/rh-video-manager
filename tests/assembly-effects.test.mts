import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { assemblyVersionSchema } from '../src/shared/contracts/assembly.ts'
import { assemblyTransitionKindSchema, frameMaskSchema } from '../src/shared/contracts/assembly-effects.ts'
import { assemblyTransitions, isOverlappingTransition, transitionClipPath } from '../src/shared/assembly-transitions.ts'
import { defaultFilmMask, maskPixels, surfacePixels, titlePresets } from '../src/shared/assembly-surfaces.ts'
import { timelineClips, totalDuration, clipOpacity } from '../src/shared/assembly-timing.ts'
import { applyAssemblyEdits, createTitleClip } from '../src/shared/assembly-edit.ts'
import { layoutTitle } from '../src/shared/title-layout.ts'
import { titleAss } from '../src/main/modules/assembly/adapters/ffmpeg-generated-visual.ts'
import { encodeAssemblyPng } from '../src/main/modules/assembly/adapters/assembly-raster-png.ts'
import { AssemblyService } from '../src/main/modules/assembly/application/assembly-service.ts'
import { SqliteAssemblyRepository } from '../src/main/modules/assembly/adapters/sqlite-assembly-repository.ts'

const visual = () => ({ ...titlePresets['silent-dialogue']!.visual, text: '听说伴君如伴虎' })
const fixture = () => assemblyVersionSchema.parse({ id: randomUUID(), name: '原版', clips: [createTitleClip(visual(), 4, randomUUID), createTitleClip(visual(), 4, randomUUID)], sounds: [] })

test('所有公开转场都有时间语义及导出适配，重叠转场使用真实选区', () => {
  assert.deepEqual(Object.keys(assemblyTransitions), assemblyTransitionKindSchema.options)
  for (const kind of assemblyTransitionKindSchema.options) {
    const version = fixture()
    version.clips[1]!.transition = { kind, duration: 0.5 }
    assert.equal(assemblyVersionSchema.safeParse(version).success, true)
    const overlap = isOverlappingTransition(kind)
    assert.equal(totalDuration(version), overlap ? 7.5 : 8)
    assert.equal(timelineClips(version)[1]!.start, overlap ? 3.5 : 4)
    if (overlap) assert.ok(assemblyTransitions[kind].expression)
    const incoming = timelineClips(version)[1]!
    assert.equal(clipOpacity(version, 1, incoming.start), kind === 'dissolve' || !overlap ? 0 : 1)
  }
})

test('擦除和虹膜预览参数有稳定首尾，不接受外部表达式', () => {
  assert.equal(transitionClipPath('wipe-right', 0), 'inset(0 100% 0 0)')
  assert.equal(transitionClipPath('wipe-right', 1), 'inset(0 0% 0 0)')
  assert.match(transitionClipPath('iris-open', 0)!, /ellipse\(0% 0%/)
  assert.match(transitionClipPath('iris-close', 1, true)!, /ellipse\(0% 0%/)
  assert.equal(transitionClipPath('iris-close', 0), undefined)
  assert.equal(assemblyTransitionKindSchema.safeParse('custom').success, false)
  assert.equal(frameMaskSchema.safeParse({ ...defaultFilmMask, expression: 'read-file' }).success, false)
  const version = fixture()
  version.clips[1]!.transition = { kind: 'wipe-left', duration: 4 }
  assert.equal(assemblyVersionSchema.safeParse(version).success, false)
})

test('遮罩中心透明、边缘变黑、强度为零关闭效果，纹理可确定重现', () => {
  const alpha = (pixels: Uint8ClampedArray, x: number, y: number) => pixels[(y * 100 + x) * 4 + 3]
  for (const kind of ['rounded', 'ellipse'] as const) {
    const pixels = maskPixels(100, 100, { ...defaultFilmMask, kind })
    assert.equal(alpha(pixels, 50, 50), 0)
    assert.equal(alpha(pixels, 0, 0), 255)
    assert.equal(alpha(pixels, 4, 4), alpha(pixels, 95, 95))
  }
  assert.ok(maskPixels(20, 20, { ...defaultFilmMask, strength: 0 }).every((value) => value === 0))
  const plain = surfacePixels(8, 8, '#112233', 'plain')
  assert.deepEqual([...plain.subarray(0, 4)], [17, 34, 51, 255])
  assert.deepEqual(surfacePixels(20, 20, '#aaaaaa', 'paper'), surfacePixels(20, 20, '#aaaaaa', 'paper'))
  assert.notDeepEqual(surfacePixels(20, 20, '#aaaaaa', 'paper'), surfacePixels(20, 20, '#aaaaaa', 'plain'))
})

test('导出PNG实际携带共用算法的RGBA像素，不依赖系统图片工具', () => {
  const request = { kind: 'mask' as const, width: 16, height: 12, mask: defaultFilmMask }
  const png = encodeAssemblyPng(request)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const compressed: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const rows = inflateSync(Buffer.concat(compressed)), pixels = maskPixels(16, 12, defaultFilmMask)
  for (let y = 0; y < 12; y++) {
    assert.equal(rows[y * 65], 0)
    assert.deepEqual([...rows.subarray(y * 65 + 1, y * 65 + 65)], [...pixels.subarray(y * 64, (y + 1) * 64)])
  }
})

test('等时替换黑场保留原片区间、音乐、后续时间及输入；只移除指定字幕', () => {
  const version = fixture()
  version.clips[1]!.gapBefore = 2
  const caption = { id: randomUUID(), start: 4, end: 6, text: '旁白' }
  version.captions = [caption, { id: randomUUID(), start: 7, end: 8, text: '后文' }]
  version.sounds = [{ id: randomUUID(), clipId: null, title: '音乐', kind: 'music', state: 'missing', assetId: null, start: 0, duration: 10, gain: 1, evidence: '' }]
  const snapshot = JSON.stringify(version)
  const result = applyAssemblyEdits(version, [{ kind: 'replace-gap-with-title', beforeClipId: version.clips[1]!.id, visual: visual(), removeCaptionIds: [caption.id] }], randomUUID)
  assert.equal(totalDuration(result), totalDuration(version))
  assert.deepEqual(timelineClips(result).map(({ start, end }) => [start, end]), [[0, 4], [4, 6], [6, 10]])
  assert.deepEqual(result.sounds, version.sounds)
  assert.deepEqual(result.captions, version.captions.slice(1))
  assert.equal(JSON.stringify(version), snapshot)
  assert.throws(() => applyAssemblyEdits(version, [{ kind: 'replace-gap-with-title', beforeClipId: version.clips[1]!.id, visual: visual(), removeCaptionIds: [version.captions![1]!.id] }], randomUUID), /只能移除/)
})

test('片头主副标题共享留白布局，ASS转义用户文字，本地宋体不回退系统字体', () => {
  const opening = { ...titlePresets['silent-opening']!.visual, text: 'AV穿越记', subtitle: 'A Silent Dream {test}' }
  const canvas = { width: 1280, height: 720, fit: 'contain' as const }
  const layout = layoutTitle(opening, canvas)
  assert.equal(layout.fits, true)
  assert.ok(layout.height > layout.mainHeight)
  const ass = titleAss(opening, canvas)
  assert.match(ass, /Noto Serif CJK SC/)
  assert.match(ass, /A Silent Dream \\\{test\\\}/)
  assert.match(ass, /Dialogue: 1/)
})

test('结构化编辑按修订原子保存，可另存版本，失败不新增历史', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE workspace_trash (id TEXT PRIMARY KEY)')
    const service = new AssemblyService(new SqliteAssemblyRepository(db), { get: () => { throw new Error('纯文字卡不读取素材') } }, randomUUID)
    const version = fixture()
    const document = service.save({ id: null, projectId: null, expectedRevision: 0,
      content: { title: '测试', episode: null, versions: [version], activeVersionId: version.id } })
    const saved = service.edit({ id: document.id, projectId: null, versionId: version.id, expectedRevision: 1, copyAs: '效果版',
      operations: [{ kind: 'set-mask', clipId: null, mask: defaultFilmMask }] })
    assert.equal(saved.versions.length, 2)
    assert.equal(saved.versions[0]!.frameMask, undefined)
    assert.deepEqual(saved.versions[1]!.frameMask, defaultFilmMask)
    assert.throws(() => service.edit({ id: document.id, projectId: null, versionId: version.id, expectedRevision: 1,
      operations: [{ kind: 'set-mask', clipId: null, mask: null }] }), /已更新/)
    assert.throws(() => service.edit({ id: document.id, projectId: null, versionId: version.id, expectedRevision: 2, operations: [
      { kind: 'set-mask', clipId: null, mask: defaultFilmMask }, { kind: 'set-transition', clipId: version.clips[0]!.id, transition: { kind: 'wipe-left', duration: 0.5 } }
    ] }))
    assert.equal(service.get(document.id, null).revision, 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assembly_history').get()!.n, 2)
    const capabilities = service.capabilities()
    assert.equal(capabilities.protocolVersion, 2)
    assert.equal(capabilities.operations.exportViaMcp, false)
    assert.equal(capabilities.transitions.length, assemblyTransitionKindSchema.options.length)
  } finally { db.close() }
})
