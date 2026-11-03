import test from 'node:test'
import assert from 'node:assert/strict'
import { reorderDraftSubset } from '../src/renderer/src/features/workbench/draft-order.ts'

const drafts = [{ id: 'a', duration: 5 }, { id: 'b', duration: 8 }, { id: 'c', duration: 10 }, { id: 'd', duration: 6 }]

test('草稿整体排序保留内容且不修改输入', () => {
  const result = reorderDraftSubset(drafts, ['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c'])
  assert.deepEqual(result.map((draft) => draft.id), ['d', 'a', 'b', 'c'])
  assert.equal(result[0], drafts[3])
  assert.equal(result[0].duration, 6)
  assert.deepEqual(drafts.map((draft) => draft.id), ['a', 'b', 'c', 'd'])
})

test('分类筛选排序不挪动隐藏草稿', () => {
  const result = reorderDraftSubset(drafts, ['a', 'c'], ['c', 'a'])
  assert.deepEqual(result.map((draft) => draft.id), ['c', 'b', 'a', 'd'])
  assert.equal(result[1], drafts[1])
  assert.equal(result[3], drafts[3])
})

test('拒绝丢失、重复、未知以及越过筛选范围的草稿标识', () => {
  for (const ids of [['a'], ['a', 'a'], ['a', 'missing'], ['a', 'b']]) {
    assert.throws(() => reorderDraftSubset(drafts, ['a', 'c'], ids))
  }
  assert.throws(() => reorderDraftSubset(drafts, ['a', 'missing'], ['missing', 'a']))
  assert.throws(() => reorderDraftSubset(drafts, ['a', 'a'], ['a', 'c']))
})

test('空列表和原顺序保持稳定', () => {
  assert.deepEqual(reorderDraftSubset([], [], []), [])
  assert.deepEqual(reorderDraftSubset(drafts, ['a', 'c'], ['a', 'c']), drafts)
})
