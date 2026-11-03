import test from 'node:test'
import assert from 'node:assert/strict'
import { edgeScrollSpeed, intersectsSelection, marqueeSelection, selectionRect } from '../src/renderer/src/features/assets/marquee-selection.ts'

test('框选支持四个拖动方向，并以相交面积判断命中', () => {
  const expected = { left: 10, top: 20, width: 40, height: 60 }
  for (const [start, end] of [
    [{ x: 10, y: 20 }, { x: 50, y: 80 }],
    [{ x: 50, y: 80 }, { x: 10, y: 20 }],
    [{ x: 50, y: 20 }, { x: 10, y: 80 }],
    [{ x: 10, y: 80 }, { x: 50, y: 20 }]
  ] as const) assert.deepEqual(selectionRect(start, end), expected)
  assert.equal(intersectsSelection(expected, { left: 49, top: 79, width: 20, height: 20 }), true)
  assert.equal(intersectsSelection(expected, { left: 50, top: 20, width: 20, height: 20 }), false)
  assert.equal(intersectsSelection(expected, { left: 100, top: 100, width: 20, height: 20 }), false)
})

test('普通框选替换选择，Ctrl 框选按初始快照切换且无重复', () => {
  assert.deepEqual(marqueeSelection(['a'], ['b', 'c'], false), ['b', 'c'])
  assert.deepEqual(marqueeSelection(['a'], [], false), [])
  assert.deepEqual(marqueeSelection(['a', 'b'], ['b', 'c'], true), ['a', 'c'])
  assert.deepEqual(marqueeSelection(['a', 'b'], ['b', 'c'], true), ['a', 'c'])
  assert.deepEqual(marqueeSelection(['a', 'b'], [], true), ['a', 'b'])
})

test('边缘滚动仅在边缘触发，越界时速度有上限，小容器方向正确', () => {
  assert.equal(edgeScrollSpeed(100, 200), 0)
  assert.equal(edgeScrollSpeed(0, 200), -720)
  assert.equal(edgeScrollSpeed(200, 200), 720)
  assert.equal(edgeScrollSpeed(-100, 200), -720)
  assert.equal(edgeScrollSpeed(300, 200), 720)
  assert.equal(edgeScrollSpeed(10, 20), 0)
  assert.equal(edgeScrollSpeed(0, 0), 0)
})
