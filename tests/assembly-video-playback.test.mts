import test from 'node:test'
import assert from 'node:assert/strict'
import { AssemblyVideoPreparation, shouldHoldAssemblyVideo, canAdvanceAssemblyVideo } from '../src/renderer/src/features/assembly/assembly-video-playback.ts'

test('暂停拖动覆盖预载标记和未结束的旧定位，最后一段采用最新目标', () => {
  const preparation = new AssemblyVideoPreparation()
  const element = { readyState: 2, seeking: false, ended: false, currentTime: 0, duration: 15.083333 }
  preparation.prepare(element, 0)
  element.seeking = true
  assert.equal(preparation.seek(element, 12), false)
  assert.equal(element.currentTime, 12)
  preparation.seek(element, 7.058333)
  assert.equal(element.currentTime, 7.058333)
  element.seeking = false
  assert.equal(preparation.seek(element, 7.058333), true)
  // 解码载入后若仍落在旧帧，媒体事件必须重新校正，不能被 positioned 拦住。
  element.currentTime = 0
  preparation.seek(element, 7.058333)
  assert.equal(element.currentTime, 7.058333)
})

test('主动逐帧定位保留小于旧准备阈值的位移，未加载元数据后可重试', () => {
  const preparation = new AssemblyVideoPreparation()
  const element = { readyState: 0, seeking: false, ended: false, currentTime: 0, duration: 15 }
  assert.equal(preparation.seek(element, 3), false)
  assert.equal(element.currentTime, 0)
  element.readyState = 2
  preparation.seek(element, 3)
  preparation.seek(element, 3 + 1 / 60)
  assert.equal(element.currentTime, 3 + 1 / 60)
})

test('片段只定位一次，缓冲恢复不反复向回定位', () => {
  const preparation = new AssemblyVideoPreparation()
  const element = { readyState: 2, seeking: false, ended: false, currentTime: 0, duration: 10 }
  assert.equal(preparation.prepare(element, 3), false)
  assert.equal(element.currentTime, 3)
  element.seeking = true
  assert.equal(preparation.prepare(element, 3), false)
  element.seeking = false
  element.currentTime = 3.5
  assert.equal(preparation.prepare(element, 3), true)
  assert.equal(element.currentTime, 3.5)
  preparation.reset()
  assert.equal(preparation.prepare(element, 2), false)
  assert.equal(element.currentTime, 2)
})

test('未加载元数据不记录定位，叠化两路独立准备', () => {
  const preparation = new AssemblyVideoPreparation()
  const first = { readyState: 0, seeking: false, ended: false, currentTime: 0, duration: NaN }
  const second = { readyState: 2, seeking: false, ended: false, currentTime: 0, duration: 8 }
  assert.equal(preparation.prepare(first, 4), false)
  assert.equal(preparation.prepare(second, 0), true)
  first.readyState = 1
  first.duration = 6
  assert.equal(preparation.prepare(first, 4), false)
  assert.equal(first.currentTime, 4)
})

test('抢跑时暂停等待主时钟，不改变源时间；定位不超过实际片尾', () => {
  assert.equal(shouldHoldAssemblyVideo(4.5, 4), true)
  assert.equal(shouldHoldAssemblyVideo(4.05, 4), false)
  assert.equal(shouldHoldAssemblyVideo(3.9, 4), false)
  const preparation = new AssemblyVideoPreparation()
  const element = { readyState: 2, seeking: false, ended: true, currentTime: 5, duration: 5 }
  assert.equal(preparation.prepare(element, 5.1), true)
  assert.equal(element.currentTime, 5)
})

test('新片段首帧已就绪时，异步play仍暂停不应冻结时间轴', () => {
  const element = { readyState: 2, seeking: false, paused: true }
  assert.equal(canAdvanceAssemblyVideo(element), true)
  element.readyState = 1
  assert.equal(canAdvanceAssemblyVideo(element), false)
  element.readyState = 2
  element.seeking = true
  assert.equal(canAdvanceAssemblyVideo(element), false)
})

test('下一镜提前定位入点，切点处复用准备结果不再seek', () => {
  const preparation = new AssemblyVideoPreparation()
  let time = 0
  let seeks = 0
  const upcoming = {
    readyState: 2, seeking: false, ended: false, duration: 10,
    get currentTime() { return time },
    set currentTime(value: number) { seeks++; time = value }
  }
  assert.equal(preparation.prepare(upcoming, 2.5), false)
  upcoming.seeking = true
  assert.equal(preparation.prepare(upcoming, 2.5), false)
  upcoming.seeking = false
  assert.equal(preparation.prepare(upcoming, 2.5), true)
  assert.equal(preparation.prepare(upcoming, 2.5), true)
  assert.equal(canAdvanceAssemblyVideo(upcoming), true)
  assert.equal(seeks, 1)
  preparation.reset()
  assert.equal(preparation.prepare(upcoming, 4), false)
  assert.equal(seeks, 2)
})
