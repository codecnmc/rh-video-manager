import test from 'node:test'
import assert from 'node:assert/strict'
import { placeCanvasItems, removeCanvasItems, editableImageTask } from '../src/renderer/src/features/image-generation/canvas-model.ts'
import type { Node } from '@xyflow/react'
import { applyCanvasSelection, reconcileCanvasNodes } from '../src/renderer/src/features/image-generation/canvas-flow-state.ts'

test('移出节点保留布局位置，可通过重新插入恢复', () => {
  const original = { positions: { task: { x: 10, y: 20 } }, hiddenNodeIds: [] }
  const hidden = removeCanvasItems(original, ['task', 'task'])
  assert.deepEqual(hidden.hiddenNodeIds, ['task'])
  assert.deepEqual(hidden.positions, original.positions)
  assert.deepEqual(original.hiddenNodeIds, [])
  const restored = placeCanvasItems(hidden, ['task'], { x: 100, y: 200 })
  assert.deepEqual(restored.hiddenNodeIds, [])
  assert.deepEqual(restored.positions.task, { x: 100, y: 200 })
})

test('多选素材从右键坐标按三列插入，保留其他节点并限制坐标', () => {
  const layout = { positions: { existing: { x: 1, y: 2 } }, hiddenNodeIds: ['a', 'other'] }
  const next = placeCanvasItems(layout, ['a', 'b', 'c', 'd'], { x: 50, y: 70 })
  assert.deepEqual(next.positions, { existing: { x: 1, y: 2 }, a: { x: 50, y: 70 }, b: { x: 350, y: 70 }, c: { x: 650, y: 70 }, d: { x: 50, y: 360 } })
  assert.deepEqual(next.hiddenNodeIds, ['other'])
  assert.deepEqual(placeCanvasItems(layout, ['edge'], { x: 200000, y: -200000 }).positions.edge, { x: 100000, y: -100000 })
})

test('只有草稿和未提交任务允许参考连线编辑', () => {
  assert.equal(editableImageTask({ status: 'draft' }), true)
  assert.equal(editableImageTask({ status: 'not_submitted' }), true)
  for (const status of ['queued', 'generating', 'saved', 'acceptance_unknown'] as const) assert.equal(editableImageTask({ status }), false)
})

test('拖动时重建业务节点保留测量尺寸和当前坐标，不退回未初始化状态', () => {
  const previous: Node[] = [{ id: 'a', position: { x: 100, y: 200 }, data: { title: '旧标题' },
    measured: { width: 264, height: 228 }, dragging: true, selected: false }]
  const incoming: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, data: { title: '新标题' }, selected: true }]
  const next = reconcileCanvasNodes(previous, incoming)
  assert.deepEqual(next[0]?.measured, { width: 264, height: 228 })
  assert.deepEqual(next[0]?.position, { x: 100, y: 200 })
  assert.equal(next[0]?.dragging, true)
  assert.equal(next[0]?.selected, true)
  assert.equal(next[0]?.data.title, '新标题')
  assert.equal(previous[0]?.selected, false)
})

test('拖动结束后布局可恢复，新增与移出节点按快照处理', () => {
  const previous: Node[] = [{ id: 'a', position: { x: 100, y: 200 }, data: {}, measured: { width: 264, height: 228 }, dragging: false },
    { id: 'removed', position: { x: 0, y: 0 }, data: {} }]
  const incoming: Node[] = [{ id: 'a', position: { x: 20, y: 30 }, data: {} }, { id: 'new', position: { x: 40, y: 50 }, data: {} }]
  const next = reconcileCanvasNodes(previous, incoming)
  assert.deepEqual(next.map((node) => node.id), ['a', 'new'])
  assert.deepEqual(next[0]?.position, { x: 20, y: 30 })
  assert.deepEqual(next[0]?.measured, previous[0]?.measured)
  assert.equal(next[1], incoming[1])
})

test('重复选择或清除事件不产生新状态，避免选择反馈循环', () => {
  const previous = ['a', 'b']
  assert.equal(applyCanvasSelection(previous, [{ id: 'a', selected: true }, { id: 'missing', selected: false }]), previous)
  assert.equal(applyCanvasSelection(previous, []), previous)
  assert.deepEqual(applyCanvasSelection(previous, [{ id: 'a', selected: false }, { id: 'c', selected: true }]), ['b', 'c'])
})
