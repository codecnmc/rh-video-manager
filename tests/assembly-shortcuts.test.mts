import test from 'node:test'
import assert from 'node:assert/strict'
import { assemblyShortcut } from '../src/renderer/src/features/assembly/assembly-shortcuts.ts'

const key = (value: string, patch: Partial<Parameters<typeof assemblyShortcut>[0]> = {}) => assemblyShortcut({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, ...patch })

test('剪辑快捷键覆盖撤销重做保存分割与播放', () => {
  assert.equal(key('z', { ctrlKey: true }), 'undo')
  assert.equal(key('Z', { ctrlKey: true, shiftKey: true }), 'redo')
  assert.equal(key('y', { ctrlKey: true }), 'redo')
  assert.equal(key('z', { metaKey: true }), 'undo')
  assert.equal(key('s', { ctrlKey: true }), 'save')
  assert.equal(key('b', { ctrlKey: true }), 'split')
  assert.equal(key('Delete'), 'delete')
  assert.equal(key(' '), 'play')
  assert.equal(key('ArrowLeft'), 'backward')
  assert.equal(key('ArrowRight'), 'forward')
})

test('输入法组合及额外修饰键不触发剪辑命令', () => {
  assert.equal(key('z'), null)
  assert.equal(key('z', { ctrlKey: true, isComposing: true }), null)
  assert.equal(key('z', { ctrlKey: true, altKey: true }), null)
  assert.equal(key('Delete', { ctrlKey: true }), null)
  assert.equal(key(' ', { shiftKey: true }), null)
})

test('长按只重复逐帧，不重复播放切换或编辑命令', () => {
  assert.equal(key('ArrowLeft', { repeat: true }), 'backward')
  assert.equal(key('ArrowRight', { repeat: true }), 'forward')
  assert.equal(key(' ', { repeat: true }), null)
  assert.equal(key('Delete', { repeat: true }), null)
  assert.equal(key('z', { ctrlKey: true, repeat: true }), null)
})
