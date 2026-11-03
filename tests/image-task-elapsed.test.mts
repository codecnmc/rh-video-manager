import test from 'node:test'
import assert from 'node:assert/strict'
import { imageTaskElapsed } from '../src/renderer/src/features/image-generation/task-elapsed.ts'
import { imageNodeSchema } from '../src/shared/contracts/image-generation.ts'

test('本地请求计时显示亚秒、实时等待和中断耗时，不伪装远端进度', () => {
  const node = imageNodeSchema.parse({ id: '24b468bf-b42d-4c05-a374-265938a90f67', boardId: '48e46b57-4d24-4c37-b591-3cb0fe5be28c',
    projectId: null, title: '计时', prompt: '图片', size: '1280x720', accountId: null, references: [], revision: 1,
    status: 'generating', submittedAt: '2026-10-26T11:58:52.245Z', finishedAt: null, createdAt: '', updatedAt: '',
    error: '', accountSnapshot: null, assetId: null, review: 'pending' })
  const start = Date.parse(node.submittedAt!)
  assert.equal(imageTaskElapsed(node, start + 46), '46 毫秒')
  assert.equal(imageTaskElapsed(node, start + 2100), '2 秒')
  assert.equal(imageTaskElapsed({ ...node, status: 'acceptance_unknown', finishedAt: '2026-10-26T11:58:52.291Z' }, start + 60000), '请求中断于 46 毫秒')
  assert.equal(imageTaskElapsed({ ...node, status: 'queued', submittedAt: null }, start), '等待调度')
  assert.equal(imageTaskElapsed({ ...node, status: 'preparing', submittedAt: null }, start), '准备请求中')
  assert.equal(imageTaskElapsed(null, start), '尚未发送')
})
