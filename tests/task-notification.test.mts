import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskNotification } from '../src/main/application/task-notification.ts'
import { previewNotificationTargetSchema } from '../src/shared/contracts/preview.ts'
import type { Project } from '../src/shared/contracts/workspace.ts'

const projectId = '4c572d92-4ac1-4f8a-80bb-f533c55dd19e'
const draftId = '9af3244e-49ea-4802-b9f9-32081be75766'
const id = '15046fd9-698b-4fd0-8541-e37c02258254'
const project: Project = { id: projectId, name: '穿越了', sample: false, episodes: [], videoDrafts: [
  { id: draftId, title: '03A｜御书房门前', description: '', prompt: '', promptDocument: '', duration: 5,
    aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto' }
] }

test('采样通知包含项目、草稿、任务ID，并指向本次任务的采样预览', () => {
  const notification = createTaskNotification({ id, projectId, draftId, taskId: '123456789012' }, [project], '实时采样已完成', 'sampling')
  assert.match(notification.title, /03A｜御书房门前/)
  assert.match(notification.body, /穿越了 \/ 03A｜御书房门前/)
  assert.match(notification.body, /123456789012/)
  assert.match(notification.body, /实时采样已完成/)
  assert.deepEqual(previewNotificationTargetSchema.parse(notification.target), { id, projectId, draftId, kind: 'sampling' })
})

test('同草稿的不同生成任务保留各自目标，不根据草稿猜最新任务', () => {
  const secondId = '40399cd2-0ee6-4cb1-acdc-122d2ad0f3f9'
  const first = createTaskNotification({ id, projectId, draftId, taskId: '123456789012' }, [project], '完成')
  const second = createTaskNotification({ id: secondId, projectId, draftId, taskId: '123456789013' }, [project], '完成')
  assert.equal(first.target.id, id)
  assert.equal(second.target.id, secondId)
  assert.equal(first.target.kind, undefined)
})

test('已删除项目草稿仍显示任务标识，通知边界拒绝非法目标', () => {
  const notification = createTaskNotification({ id, projectId, draftId, taskId: '' }, [], '视频任务失败')
  assert.match(notification.body, /项目不可用 \/ 草稿不可用/)
  assert.ok(notification.body.includes(id))
  assert.equal(previewNotificationTargetSchema.safeParse({ ...notification.target, id: '../other' }).success, false)
  assert.equal(previewNotificationTargetSchema.safeParse({ ...notification.target, kind: 'unknown' }).success, false)
})
