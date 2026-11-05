import test from 'node:test'
import assert from 'node:assert/strict'
import { useScriptLibraryUi } from '../src/renderer/src/features/scripts/script-library-store.ts'

test('剧本浏览位置在组件卸载后仍按项目及未归属范围独立保留', () => {
  useScriptLibraryUi.setState({ unassignedByProject: {}, selectedByScope: {} })
  const ui = useScriptLibraryUi.getState()
  ui.selectDocument('project-a', 'script-a')
  ui.selectDocument('project-b', 'script-b')
  ui.selectDocument(null, 'script-public')
  ui.setUnassigned('project-a', true)

  const restored = useScriptLibraryUi.getState()
  assert.equal(restored.selectedByScope['project-a'], 'script-a')
  assert.equal(restored.selectedByScope['project-b'], 'script-b')
  assert.equal(restored.selectedByScope.unassigned, 'script-public')
  assert.equal(restored.unassignedByProject['project-a'], true)
  assert.equal(restored.unassignedByProject['project-b'] ?? false, false)

  restored.selectDocument('project-a', null)
  assert.equal(useScriptLibraryUi.getState().selectedByScope['project-a'], null)
  assert.equal(useScriptLibraryUi.getState().selectedByScope['project-b'], 'script-b')
  assert.equal(useScriptLibraryUi.getState().selectedByScope.unassigned, 'script-public')
})
