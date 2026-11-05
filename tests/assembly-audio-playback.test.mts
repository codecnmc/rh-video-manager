import test from 'node:test'
import assert from 'node:assert/strict'
import { AssemblyAudioPlayback } from '../src/renderer/src/features/assembly/assembly-audio-playback.ts'
import { AssemblyPlaybackCoordinator } from '../src/renderer/src/features/assembly/assembly-playback-coordinator.ts'

function fixture() {
  let complete: () => void = () => {}
  let fail: (error: Error) => void = () => {}
  const element = {
    readyState: 2, seeking: false, paused: true, ended: false, currentTime: 0, duration: 155, playbackRate: 1,
    calls: 0, pauses: 0,
    play() {
      this.calls++
      return new Promise<void>((resolve, reject) => {
        complete = () => { this.paused = false; resolve() }
        fail = reject
      })
    },
    pause() { this.pauses++; this.paused = true }
  }
  return { element, complete: () => complete(), fail: (error: Error) => fail(error) }
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const unexpectedError = () => assert.fail('不应触发播放错误')

test('音频启动未完成时不逐帧重复play，缓冲取消后可恢复', async () => {
  const playback = new AssemblyAudioPlayback()
  const f = fixture()
  const errors: unknown[] = []
  const sync = (playing: boolean) => playback.sync(f.element, 0, playing, 0, 0, (error) => errors.push(error))
  sync(true); sync(true); sync(true)
  assert.equal(f.element.calls, 1)
  sync(false)
  f.fail(Object.assign(new Error('interrupted'), { name: 'AbortError' }))
  await settled()
  sync(true)
  assert.equal(f.element.calls, 2)
  f.complete()
  await settled()
  assert.equal(f.element.paused, false)
  assert.deepEqual(errors, [])
})

test('音频抢跑只暂停等待，不逐帧向回seek；主动跳转重新定位', () => {
  const playback = new AssemblyAudioPlayback()
  const { element } = fixture()
  playback.sync(element, 0, false, 0, 0, unexpectedError)
  element.currentTime = 3
  element.paused = false
  playback.sync(element, 2.5, true, 0, 500, unexpectedError)
  assert.equal(element.paused, true)
  assert.equal(element.currentTime, 3)
  playback.sync(element, 1, true, 1, 600, unexpectedError)
  assert.equal(element.currentTime, 1)
})

test('落后仍保持原速，元数据和seek未完成时不启动', () => {
  const playback = new AssemblyAudioPlayback()
  const { element } = fixture()
  element.readyState = 0
  playback.sync(element, 4, true, 0, 0, unexpectedError)
  assert.equal(element.calls, 0)
  element.readyState = 2
  playback.sync(element, 4, true, 0, 100, unexpectedError)
  assert.equal(element.currentTime, 4)
  element.seeking = true
  playback.sync(element, 4, true, 0, 200, unexpectedError)
  assert.equal(element.calls, 0)
  element.seeking = false
  element.paused = false
  playback.sync(element, 4.5, true, 0, 300, unexpectedError)
  assert.equal(element.currentTime, 4)
  playback.sync(element, 5.5, true, 0, 1200, unexpectedError)
  assert.equal(element.currentTime, 4)
  assert.equal(element.playbackRate, 1)
})

test('过期启动不在暂停后发声，真实失败只报告一次直到重新播放', async () => {
  const playback = new AssemblyAudioPlayback()
  const f = fixture()
  let errors = 0
  const sync = (epoch: number) => playback.sync(f.element, 0, true, epoch, 0, () => { errors++ })
  sync(0)
  playback.stop(f.element)
  f.complete()
  await settled()
  assert.equal(f.element.paused, true)
  sync(1)
  f.fail(new Error('decode'))
  await settled()
  sync(1); sync(1)
  assert.equal(errors, 1)
  assert.equal(f.element.calls, 2)
  sync(2)
  assert.equal(f.element.calls, 3)
  f.complete()
  await settled()
})

test('切镜缓冲不重定位背景音乐，恢复仍从整集源位置继续', async () => {
  const playback = new AssemblyAudioPlayback()
  const f = fixture()
  f.element.currentTime = 12
  playback.sync(f.element, 12, true, 1, 100, unexpectedError)
  f.complete()
  await settled()
  for (let i = 0; i < 5; i++) playback.sync(f.element, 11.95, true, 1, 200 + i, unexpectedError, true)
  assert.equal(f.element.currentTime, 12)
  assert.equal(f.element.paused, true)
  assert.equal(f.element.calls, 1)
  playback.sync(f.element, 12, true, 1, 300, unexpectedError)
  assert.equal(f.element.currentTime, 12)
  assert.equal(f.element.calls, 2)
  f.complete()
  await settled()
})

test('两条混音音轨跨多个画面接点保持源位置，不重启音乐', async () => {
  const players = [new AssemblyAudioPlayback(), new AssemblyAudioPlayback()]
  const fixtures = [fixture(), fixture()]
  players.forEach((player, i) => player.sync(fixtures[i]!.element, 0, true, 1, 0, unexpectedError))
  fixtures.forEach((f) => f.complete())
  await settled()
  for (const time of [0.9, 1, 1.1, 3, 3.5, 4, 10]) {
    players.forEach((player, i) => {
      const f = fixtures[i]!
      f.element.currentTime = time
      player.sync(f.element, time, true, 1, time * 1000, unexpectedError)
      assert.equal(f.element.currentTime, time)
      assert.equal(f.element.calls, 1)
      assert.equal(f.element.paused, false)
    })
  }
})

test('试听与时间轴互斥，但同一时间轴内的两条音轨不互斥', () => {
  const coordinator = new AssemblyPlaybackCoordinator()
  const timeline = {}, firstAudition = {}, secondAudition = {}
  let firstTrackPaused = false, secondTrackPaused = false, firstAuditionPaused = false, secondAuditionPaused = false
  const releaseTimeline = coordinator.register(timeline, () => { firstTrackPaused = true; secondTrackPaused = true })
  coordinator.register(firstAudition, () => { firstAuditionPaused = true })
  coordinator.register(secondAudition, () => { secondAuditionPaused = true })
  coordinator.claim(timeline)
  assert.equal(firstTrackPaused, false)
  assert.equal(secondTrackPaused, false)
  assert.equal(firstAuditionPaused, true)
  assert.equal(secondAuditionPaused, true)
  firstAuditionPaused = false
  coordinator.claim(firstAudition)
  assert.equal(firstTrackPaused, true)
  assert.equal(secondTrackPaused, true)
  assert.equal(firstAuditionPaused, false)
  releaseTimeline()
  firstAuditionPaused = false
  coordinator.pauseAll()
  assert.equal(firstAuditionPaused, true)
})

test('暂停点击时间轴后，MP3量化定位与seeked回调不能形成反复seek', () => {
  const playback = new AssemblyAudioPlayback()
  const { element } = fixture()
  let actualTime = 0
  let seeks = 0
  Object.defineProperty(element, 'currentTime', {
    get: () => actualTime,
    set: (value: number) => { seeks++; actualTime = Math.floor(value * 10) / 10 }
  })
  playback.sync(element, 10.047, false, 1, 0, unexpectedError)
  for (let i = 0; i < 100; i++) playback.sync(element, 10.047, false, 1, i * 20, unexpectedError)
  assert.equal(seeks, 1)
  assert.equal(element.currentTime, 10)
  assert.equal(element.paused, true)
  assert.equal(element.calls, 0)
  playback.sync(element, 20.047, false, 2, 3000, unexpectedError)
  assert.equal(seeks, 2)
})

test('播放时钟持续领先音频也不每秒重定位和重播音乐', async () => {
  const playback = new AssemblyAudioPlayback()
  const f = fixture()
  let actualTime = 0
  let seeks = 0
  Object.defineProperty(f.element, 'currentTime', {
    get: () => actualTime,
    set: (value: number) => { seeks++; actualTime = value }
  })
  playback.sync(f.element, 10, true, 1, 0, unexpectedError)
  playback.sync(f.element, 10, true, 1, 10, unexpectedError)
  f.complete()
  await settled()
  for (let i = 1; i <= 300; i++) {
    actualTime = 10 + i / 30
    playback.sync(f.element, actualTime + 0.5, true, 1, i * 1000 / 30, unexpectedError)
  }
  assert.equal(seeks, 1)
  assert.equal(f.element.calls, 1)
  assert.equal(f.element.playbackRate, 1)
  assert.equal(f.element.paused, false)
  playback.stop(f.element)
  assert.equal(f.element.playbackRate, 1)
})

test('小幅正负漂移不触发保调变速或重新启动音乐', async () => {
  const playback = new AssemblyAudioPlayback()
  const f = fixture()
  playback.sync(f.element, 0, true, 1, 0, unexpectedError)
  f.complete()
  await settled()
  for (const [index, drift] of [0.06, -0.06, 0.1, -0.1, 0].entries()) {
    const time = index + 1
    f.element.currentTime = time + drift
    playback.sync(f.element, time, true, 1, time * 1000, unexpectedError)
    assert.equal(f.element.playbackRate, 1)
    assert.equal(f.element.currentTime, time + drift)
    assert.equal(f.element.calls, 1)
    assert.equal(f.element.paused, false)
  }
})
