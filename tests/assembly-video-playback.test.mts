import test from 'node:test'
import assert from 'node:assert/strict'
import { AssemblyVideoPreparation, shouldHoldAssemblyVideo, canAdvanceAssemblyVideo } from '../src/renderer/src/features/assembly/assembly-video-playback.ts'

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
