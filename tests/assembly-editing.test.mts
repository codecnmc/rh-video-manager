import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { assemblyVersionSchema, assemblySoundSchema } from '../src/shared/contracts/assembly.ts'
import { clipOpacity, soundGain, soundEnvelope, soundStart, timelineClips, totalDuration } from '../src/shared/assembly-timing.ts'
import { removeClip, splitClip, splitSound, rollingTrim, snapTime } from '../src/renderer/src/features/assembly/assembly-state.ts'
import { captionsFromPrompts, parseSrt, serializeSrt } from '../src/renderer/src/features/assembly/assembly-subtitles.ts'

function fixture() {
  return assemblyVersionSchema.parse({ id: randomUUID(), name: '粗剪', sounds: [], clips: [0, 1, 2].map((index) => ({
    id: randomUUID(), assetId: randomUUID(), title: `片段 ${index + 1}`, sourceDuration: 10, inPoint: 1, outPoint: 5, originalAudio: true, prompt: ''
  })) })
}

test('旧版本无需新增字段即可读取，默认仍为顺序硬切', () => {
  const version = fixture()
  assert.equal(version.tracks, undefined)
  assert.equal(version.captions, undefined)
  assert.equal(version.clips[0]!.transition, undefined)
  assert.deepEqual(timelineClips(version).map(({ start, end }) => [start, end]), [[0, 4], [4, 8], [8, 12]])
})

test('叠化使用相邻已选源区间，黑场转场不改变总长，空隙单独计时', () => {
  const version = fixture()
  version.clips[1]!.transition = { kind: 'dissolve', duration: 1 }
  version.clips[2]!.transition = { kind: 'black', duration: 1 }
  assert.equal(assemblyVersionSchema.safeParse(version).success, true)
  assert.deepEqual(timelineClips(version).map(({ start, end }) => [start, end]), [[0, 4], [3, 7], [7, 11]])
  assert.equal(totalDuration(version), 11)
  assert.equal(clipOpacity(version, 1, 3.5), 0.5)
  assert.equal(clipOpacity(version, 1, 6.75), 0.5)
  assert.equal(clipOpacity(version, 2, 7.25), 0.5)
  delete version.clips[2]!.transition
  version.clips[2]!.gapBefore = 2
  assert.equal(totalDuration(version), 13)
})

test('拒绝首段转场、空隙上的转场、余量不足及不存在的音频轨道', () => {
  const version = fixture()
  version.clips[0]!.transition = { kind: 'dissolve', duration: 0.5 }
  assert.equal(assemblyVersionSchema.safeParse(version).success, false)
  delete version.clips[0]!.transition
  version.clips[1]!.transition = { kind: 'dissolve', duration: 4 }
  assert.equal(assemblyVersionSchema.safeParse(version).success, false)
  version.clips[1]!.transition.duration = 0.5
  version.clips[1]!.gapBefore = 1
  assert.equal(assemblyVersionSchema.safeParse(version).success, false)
  delete version.clips[1]!.transition
  version.sounds.push(assemblySoundSchema.parse({ id: randomUUID(), clipId: null, trackId: randomUUID(), title: '音效', kind: 'effect', state: 'missing', assetId: null, evidence: '', start: 0, duration: 1, gain: 1 }))
  assert.equal(assemblyVersionSchema.safeParse(version).success, false)
})

test('分割非破坏地保留源区间、成片总长及跨切点声音', () => {
  const version = fixture()
  const clip = version.clips[0]!
  const id = randomUUID()
  version.sounds.push(assemblySoundSchema.parse({ id: randomUUID(), clipId: clip.id, title: '连续环境声', kind: 'ambience', state: 'missing', assetId: null, evidence: '', start: 1, duration: 3, gain: 1 }))
  const split = splitClip(version, clip.id, 2, id)
  assert.equal(totalDuration(split), totalDuration(version))
  assert.deepEqual(split.clips.slice(0, 2).map((item) => [item.inPoint, item.outPoint]), [[1, 3], [3, 5]])
  assert.equal(split.sounds.length, 1)
  assert.equal(soundStart(split, split.sounds[0]!), 1)
  assert.equal(clip.outPoint, 5)
  assert.equal(splitClip(version, clip.id, 0, randomUUID()), version)
})

test('普通删除保留下一镜位置，波纹删除仅收拢片段而保留既有空隙和后配声音', () => {
  const version = fixture()
  const middle = version.clips[1]!
  middle.gapBefore = 1
  version.clips[2]!.gapBefore = 2
  version.sounds.push(assemblySoundSchema.parse({ id: randomUUID(), clipId: middle.id, title: '声音', kind: 'effect', state: 'missing', assetId: null, evidence: '', start: 1, duration: 1, gain: 1 }))
  const originalStart = timelineClips(version)[2]!.start
  const normal = removeClip(version, middle.id, false)
  assert.equal(timelineClips(normal)[1]!.start, originalStart)
  assert.equal(normal.sounds.length, 1)
  assert.equal(normal.sounds[0]!.clipId, null)
  assert.equal(normal.sounds[0]!.start, 6)
  const ripple = removeClip(version, middle.id, true)
  assert.equal(timelineClips(ripple)[1]!.start, originalStart - 4)
  assert.equal(totalDuration(ripple), totalDuration(version) - 4)
})

test('接点联动保持总长，并受两侧真实源余量约束', () => {
  const version = fixture()
  const next = rollingTrim(version, version.clips[0]!.id, 100)
  assert.equal(totalDuration(next), totalDuration(version))
  assert.ok(next.clips[1]!.inPoint < next.clips[1]!.outPoint)
  assert.ok(next.clips[0]!.outPoint <= next.clips[0]!.sourceDuration)
})

test('音频分割延续源入点，锁定轨道拒绝分割，音量与独听/静音一致', () => {
  const version = fixture()
  const track = { id: randomUUID(), name: '音效 1', kind: 'effect' as const, muted: false, solo: false, locked: false, gain: 0.5 }
  version.tracks = [track]
  const sound = assemblySoundSchema.parse({ id: randomUUID(), clipId: null, trackId: track.id, title: '动作声', kind: 'effect', state: 'bound', assetId: randomUUID(), evidence: '', start: 2, duration: 4, sourceIn: 1, sourceDuration: 8, gain: 0.8, fadeIn: 1, fadeOut: 1 })
  version.sounds = [sound]
  const split = splitSound(version, sound.id, 4, randomUUID())
  assert.deepEqual(split.sounds.map((item) => [item.start, item.duration, item.sourceIn]), [[2, 2, 1], [4, 2, 3]])
  assert.equal(soundGain(version, sound), 0.4)
  assert.equal(soundEnvelope(sound, 0.5), 0.5)
  assert.equal(soundEnvelope(sound, 3.5), 0.5)
  track.muted = true
  assert.equal(soundGain(version, sound), 0)
  track.locked = true
  assert.equal(splitSound(version, sound.id, 4, randomUUID()), version)
  assert.equal(assemblySoundSchema.safeParse({ ...sound, sourceIn: 7 }).success, false)
})

test('吸附可关闭，关闭后仍落在输出帧网格', () => {
  const version = fixture()
  version.frameRate = 25
  assert.equal(snapTime(3.96, version, 4, 100, true), 4)
  assert.equal(snapTime(3.96, version, 4, 100, false), 3.96)
})

test('SRT 支持 BOM、CRLF、多行和毫秒，拒绝错误时间且可往返导出', () => {
  const text = '\uFEFF1\r\n00:00:01,250 --> 00:00:02,500\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n下一句'
  const captions = parseSrt(text, randomUUID)
  assert.equal(captions[0]!.start, 1.25)
  assert.equal(captions[0]!.text, '第一行\n第二行')
  assert.deepEqual(parseSrt(serializeSrt(captions), randomUUID).map(({ start, end, text }) => ({ start, end, text })), captions.map(({ start, end, text }) => ({ start, end, text })))
  assert.throws(() => parseSrt('1\n00:00:05,000 --> 00:00:04,000\n反向', randomUUID))
  assert.throws(() => parseSrt('1\n00:61:00,000 --> 00:62:00,000\n非法', randomUUID))
})

test('提示词对白按源时间裁剪并映射到叠化时间轴，不提取普通引号', () => {
  const version = fixture()
  version.clips[0]!.prompt = '画面中的招牌写着“商店”\n00:00.500–00:02.500\n<d>[Chinese] 你好。</d>\n00:06.000–00:08.000 <d>已被裁去。</d>'
  version.clips[1]!.transition = { kind: 'dissolve', duration: 1 }
  version.clips[1]!.prompt = '1–3秒 她说道：“回来吧。”'
  const captions = captionsFromPrompts(version, randomUUID)
  assert.deepEqual(captions.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1.5, text: '你好。' }, { start: 3, end: 5, text: '回来吧。' }
  ])
  version.captions = captions
  assert.equal(captionsFromPrompts(version, randomUUID).length, 0)
})

test('无时间对白按字数分配原片时长，同一时间块多句不重叠', () => {
  const version = fixture()
  version.clips = [version.clips[0]!]
  version.clips[0]!.inPoint = 0
  version.clips[0]!.outPoint = 10
  version.clips[0]!.prompt = '<d>甲</d><d>乙乙乙</d>'
  assert.deepEqual(captionsFromPrompts(version, randomUUID).map(({ start, end }) => [start, end]), [[0, 2.5], [2.5, 10]])
  version.clips[0]!.prompt = '2–4秒 <d>甲</d><d>乙</d>'
  assert.deepEqual(captionsFromPrompts(version, randomUUID).map(({ start, end }) => [start, end]), [[2, 3], [3, 4]])
  version.clips[0]!.prompt = '4–2秒 <d>错误范围</d>'
  assert.equal(captionsFromPrompts(version, randomUUID).length, 0)
})
