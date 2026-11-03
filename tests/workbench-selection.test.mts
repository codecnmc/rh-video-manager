import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSavedDraft, useWorkbenchUi } from '../src/renderer/src/features/workbench/workbench-store.ts'
import type { VideoDraft } from '../src/shared/contracts/video.ts'

function draft(id: string): VideoDraft {
  return { id, title: id, description: '', prompt: '', promptDocument: '', duration: 8,
    aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto' }
}

test('未选择或选择失效时使用现有草稿，空项目保持空白', () => {
  const drafts = [draft('first'), draft('second')]
  assert.equal(resolveSavedDraft(drafts, { draftId: null, creatingDraft: false }), drafts[0])
  assert.equal(resolveSavedDraft(drafts, { draftId: 'removed', creatingDraft: false }), drafts[0])
  assert.equal(resolveSavedDraft(drafts, { draftId: 'second', creatingDraft: false }), drafts[1])
  assert.equal(resolveSavedDraft([], { draftId: null, creatingDraft: false }), undefined)
})

test('主动新建不回退已有草稿，保存、选中、切换项目后退出新建状态', () => {
  const original = useWorkbenchUi.getState()
  const drafts = [draft('first'), draft('second')]
  try {
    original.selectProject('project-a')
    assert.equal(resolveSavedDraft(drafts, useWorkbenchUi.getState()), drafts[0])

    useWorkbenchUi.getState().startDraft()
    assert.equal(resolveSavedDraft(drafts, useWorkbenchUi.getState()), undefined)
    useWorkbenchUi.getState().setView('assets')
    useWorkbenchUi.getState().setView('video')
    assert.equal(useWorkbenchUi.getState().creatingDraft, true)

    useWorkbenchUi.getState().selectDraft('second')
    assert.equal(useWorkbenchUi.getState().creatingDraft, false)
    assert.equal(resolveSavedDraft(drafts, useWorkbenchUi.getState()), drafts[1])

    useWorkbenchUi.getState().startDraft()
    useWorkbenchUi.getState().selectProject('project-b')
    assert.equal(useWorkbenchUi.getState().creatingDraft, false)
    assert.equal(resolveSavedDraft(drafts, useWorkbenchUi.getState()), drafts[0])

    useWorkbenchUi.getState().startDraft()
    useWorkbenchUi.getState().selectDraft(null)
    assert.equal(resolveSavedDraft(drafts, useWorkbenchUi.getState()), drafts[0])
  } finally {
    useWorkbenchUi.setState(original, true)
  }
})
