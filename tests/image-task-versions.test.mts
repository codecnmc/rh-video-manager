import test from 'node:test'
import assert from 'node:assert/strict'
import type { ImageNode } from '../src/shared/contracts/image-generation.ts'
import { canRegenerateImageTask, imageTaskVersions, imageVersionRoot, imageRetryHasUnknownHistory, latestImageTaskIds } from '../src/renderer/src/features/image-generation/task-versions.ts'

function node(id: string, sourceNodeId?: string): ImageNode {
  return { id, sourceNodeId, boardId: 'board', projectId: null, title: '同名任务', prompt: '', size: '1280x720',
    accountId: null, references: [], revision: 1, status: 'draft', createdAt: id, updatedAt: '', submittedAt: null,
    finishedAt: null, error: '', accountSnapshot: null, assetId: null, review: 'pending', automaticAccount: false }
}

test('生成版本按明确来源归组，不把同名任务误认为同一系列', () => {
  const nodes = [node('a'), node('b', 'a'), node('c', 'b'), node('d')]
  assert.deepEqual(imageTaskVersions('c', nodes).map((item) => item.id), ['a', 'b', 'c'])
  assert.deepEqual(imageTaskVersions('d', nodes).map((item) => item.id), ['d'])
})

test('来源已删除时保留系列关系，异常循环不会无限遍历', () => {
  assert.equal(imageVersionRoot('b', [node('b', 'a')]), 'a')
  assert.deepEqual(imageTaskVersions('b', [node('b', 'a'), node('c', 'b')]).map((item) => item.id), ['b', 'c'])
  assert.equal(imageVersionRoot('a', [node('a', 'b'), node('b', 'a')]), 'a')
})

test('重试后再次重试仍提示受理不明历史风险，不按名称猜测', () => {
  const a = { ...node('a'), status: 'resolved' as const }
  const b = node('b', 'a'), c = node('c', 'b'), d = node('d')
  assert.equal(imageRetryHasUnknownHistory(c, [a, b, c, d]), true)
  assert.equal(imageRetryHasUnknownHistory(d, [a, b, c, d]), false)
})

test('每组只展示最新生成卡片，所有旧记录仍可查询且互不覆盖', () => {
  const nodes = [node('a'), node('b', 'a'), node('c', 'b'), node('d')]
  const snapshot = JSON.stringify(nodes)
  assert.deepEqual([...latestImageTaskIds(nodes)], ['c', 'd'])
  assert.deepEqual(imageTaskVersions('c', nodes).map((item) => item.id), ['a', 'b', 'c'])
  assert.equal(JSON.stringify(nodes), snapshot)
  assert.deepEqual([...latestImageTaskIds([node('b', 'a'), node('c', 'b')])], ['c'])
})

test('重新生成仅允许已结束任务，不能绕过在途和受理不明保护', () => {
  for (const status of ['saved', 'resolved', 'output_unavailable'] as const) assert.equal(canRegenerateImageTask({ status }), true)
  for (const status of ['draft', 'not_submitted', 'queued', 'preparing', 'generating', 'downloading', 'acceptance_unknown'] as const) {
    assert.equal(canRegenerateImageTask({ status }), false)
  }
})
