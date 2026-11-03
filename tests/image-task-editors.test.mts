import test from 'node:test'
import assert from 'node:assert/strict'
import type { ImageNode } from '../src/shared/contracts/image-generation.ts'
import { acknowledgeTaskSave, acknowledgeTaskCopy, imageTaskFields, sameImageTaskFields, taskSessionDirty, taskSessionConflict, updateTaskFields, syncTaskSessions, type ImageTaskSessions } from '../src/renderer/src/features/image-generation/task-editor-state.ts'

function node(id: string): ImageNode {
  return { id, boardId: 'board', projectId: null, title: id, prompt: '原提示词', size: '1280x720', accountId: null,
    references: [], revision: 1, status: 'draft', createdAt: '', updatedAt: '', submittedAt: null, finishedAt: null,
    error: '', accountSnapshot: null, assetId: null, review: 'pending', automaticAccount: false }
}

test('自动保存仅更新修订时不重置表单，外部字段变更仍可识别', () => {
  const original = node('a')
  const fields = { ...imageTaskFields(original), references: [{ assetId: 'image', expectedUpdatedAt: 'v1' }] }
  const saved = { ...original, ...fields, revision: 2 }
  assert.equal(sameImageTaskFields(fields, imageTaskFields(saved)), true)
  assert.equal(sameImageTaskFields(fields, { references: [...fields.references], accountId: fields.accountId, size: fields.size, prompt: fields.prompt, title: fields.title }), true)
  assert.equal(sameImageTaskFields(fields, { ...fields, prompt: '外部更新' }), false)
  assert.equal(sameImageTaskFields(fields, { ...fields, references: [{ assetId: 'image', expectedUpdatedAt: 'v2' }] }), false)
  assert.equal(sameImageTaskFields(fields, { ...fields, references: [] }), false)
})

test('逐字更新保留最新输入，字段键顺序不产生虚假修改', () => {
  const a = node('a')
  const fields = imageTaskFields(a)
  const initial: ImageTaskSessions = { a: { id: a.id, base: a, fields, open: true } }
  const reordered = { references: [], accountId: fields.accountId, size: fields.size, prompt: fields.prompt, title: fields.title }
  assert.equal(updateTaskFields(initial, 'a', reordered), initial)
  assert.equal(taskSessionDirty({ ...initial.a!, fields: reordered }), false)
  let latest = initial
  for (const prompt of ['新', '新的', '新的提示词']) latest = updateTaskFields(latest, 'a', { ...fields, prompt })
  assert.equal(latest.a!.fields.prompt, '新的提示词')
  assert.equal(initial.a!.fields.prompt, '原提示词')
  const response = acknowledgeTaskSave(latest, 'a', { ...fields, prompt: '新' }, { ...a, prompt: '新', revision: 2 })
  assert.equal(response.a!.fields.prompt, '新的提示词')
  assert.equal(taskSessionDirty(response.a!), true)
})

test('失败记录的修改另存为草稿，原快照保留，保存期间的新输入不丢失', () => {
  const source = { ...node('old'), status: 'output_unavailable' as const, error: '下载失败' }
  const fields = { ...imageTaskFields(source), prompt: '重写的提示词' }
  const sessions: ImageTaskSessions = { old: { id: source.id, base: source, fields, open: true } }
  const saved = { ...node('new'), ...fields, sourceNodeId: source.id }
  const next = acknowledgeTaskCopy(sessions, source, saved)
  assert.equal(next.old!.base, source)
  assert.equal(next.old!.fields.prompt, '原提示词')
  assert.equal(taskSessionDirty(next.old!), false)
  assert.equal(next.new!.base?.status, 'draft')
  assert.equal(next.new!.fields.prompt, '重写的提示词')
  assert.equal(taskSessionDirty(next.new!), false)
  const edited = updateTaskFields(sessions, source.id, { ...fields, prompt: '下载保存期间继续输入' })
  const concurrent = acknowledgeTaskCopy(edited, source, saved)
  assert.equal(concurrent.new!.fields.prompt, '下载保存期间继续输入')
  assert.equal(taskSessionDirty(concurrent.new!), true)
  assert.equal(sessions.old!.base?.error, '下载失败')
})

test('MCP 删除后的轮询清除已保存任务面板，不复活任务，保留未保存新任务', () => {
  const a = node('a')
  const sessions: ImageTaskSessions = {
    a: { id: 'a', base: a, fields: { ...imageTaskFields(a), prompt: '尚未保存的修改' }, open: true },
    local: { id: 'local', base: null, fields: imageTaskFields(a), open: true }
  }
  const updated = syncTaskSessions(sessions, [])
  assert.equal(updated.a, undefined)
  assert.equal(updated.local, sessions.local)
  assert.ok(sessions.a)
})

test('多个任务的提示词、账号、尺寸和参考图独立，修改一个不覆盖另一个', () => {
  const a = node('a'), b = node('b')
  const original: ImageTaskSessions = { a: { id: a.id, base: a, fields: imageTaskFields(a), open: true },
    b: { id: b.id, base: b, fields: imageTaskFields(b), open: true } }
  const changed = updateTaskFields(original, 'a', { ...imageTaskFields(a), prompt: 'A 新提示词', accountId: 'account-a', size: '1024x1024', references: [{ assetId: 'reference-a', expectedUpdatedAt: 'now' }] })
  assert.equal(changed.b, original.b)
  assert.equal(changed.a?.fields.prompt, 'A 新提示词')
  assert.equal(changed.b?.fields.prompt, '原提示词')
  assert.equal(changed.b?.fields.accountId, null)
  assert.deepEqual(changed.b?.fields.references, [])
  assert.equal(taskSessionDirty(changed.a!), true)
  assert.equal(taskSessionDirty(changed.b!), false)
  assert.equal(updateTaskFields(changed, 'a', changed.a!.fields), changed)
})

test('轮询只刷新无修改任务，不覆盖其他任务的本地草稿和修订', () => {
  const a = node('a'), b = node('b')
  const sessions: ImageTaskSessions = { a: { id: a.id, base: a, fields: { ...imageTaskFields(a), prompt: '本地 A' }, open: true },
    b: { id: b.id, base: b, fields: imageTaskFields(b), open: false } }
  const updated = syncTaskSessions(sessions, [{ ...a, revision: 2, prompt: '远端 A' }, { ...b, revision: 2, prompt: '远端 B' }])
  assert.equal(updated.a, sessions.a)
  assert.equal(updated.a?.base?.revision, 1)
  assert.equal(updated.b?.base?.revision, 2)
  assert.equal(updated.b?.fields.prompt, '远端 B')
  assert.equal(updated.b?.open, false)
})

test('关闭面板后草稿仍独立保留，新任务始终参与未保存保护', () => {
  const a = node('a')
  const sessions: ImageTaskSessions = { a: { id: 'a', base: null, fields: imageTaskFields(a), open: false },
    b: { id: 'b', base: null, fields: { ...imageTaskFields(a), title: 'B', prompt: '另一个草稿' }, open: true } }
  const changed = updateTaskFields(sessions, 'b', { ...sessions.b!.fields, prompt: '修改 B' })
  assert.equal(changed.a?.open, false)
  assert.equal(changed.a?.fields.prompt, '原提示词')
  assert.equal(taskSessionDirty(changed.a!), true)
  assert.equal(taskSessionDirty(changed.b!), true)
})

test('自动保存响应不覆盖保存期间的新输入，下一次保存使用新的基准修订', () => {
  const a = node('a')
  const submitted = { ...imageTaskFields(a), prompt: '提交时的提示词' }
  const sessions: ImageTaskSessions = { a: { id: 'a', base: a, fields: { ...submitted, prompt: '保存期间继续输入' }, open: true } }
  const saved = { ...a, ...submitted, revision: 2 }
  const next = acknowledgeTaskSave(sessions, 'a', submitted, saved)
  assert.equal(next.a?.fields.prompt, '保存期间继续输入')
  assert.equal(next.a?.base?.revision, 2)
  assert.equal(taskSessionDirty(next.a!), true)
  const finished = acknowledgeTaskSave(next, 'a', next.a!.fields, { ...saved, ...next.a!.fields, revision: 3 })
  assert.equal(taskSessionDirty(finished.a!), false)
  assert.equal(finished.a?.open, true)
  assert.deepEqual(acknowledgeTaskSave({}, 'a', submitted, saved), {})
})

test('同任务另一窗口更新后标记冲突，保留原输入和基准修订，未编辑任务正常同步', () => {
  const a = node('a'), b = node('b')
  const sessions: ImageTaskSessions = {
    a: { id: a.id, base: a, fields: { ...imageTaskFields(a), prompt: '本地未保存' }, open: true },
    b: { id: b.id, base: b, fields: imageTaskFields(b), open: true }
  }
  const external = [{ ...a, revision: 2, prompt: '另一窗口已保存' }, { ...b, revision: 2, prompt: '可自动同步' }]
  const synced = syncTaskSessions(sessions, external)
  assert.equal(taskSessionConflict(synced.a!, external[0]), true)
  assert.equal(synced.a!.fields.prompt, '本地未保存')
  assert.equal(synced.a!.base!.revision, 1)
  assert.equal(taskSessionConflict(synced.b!, external[1]), false)
  assert.equal(synced.b!.fields.prompt, '可自动同步')
  assert.equal(taskSessionConflict(sessions.a!, a), false)
  assert.equal(taskSessionConflict({ ...sessions.a!, base: null }, undefined), false)
})
