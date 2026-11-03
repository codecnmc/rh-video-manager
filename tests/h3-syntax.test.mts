import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { createH3SyntaxPlugin, ensureH3SyntaxPlugin, h3SyntaxPluginKey, tokenizeH3Syntax } from '../src/renderer/src/features/prompt-editor/h3-syntax.ts'
import { h3PromptSchema, h3Sections } from '../src/shared/contracts/h3.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph+' },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline' },
    promptReference: { inline: true, group: 'inline', atom: true, attrs: { label: { default: '' } } }
  },
  marks: { bold: {} }
})

test('识别三节与六节标题、引用、镜头、时间、说话人及对白控制符，保留原文偏移', () => {
  const text = `${h3Sections.map((section) => `${section}:`).join('\n')}\nintegrated_multimodal_description:\n<Subject 1> <Picture 2> <Video 3> <Audio 4> [Shot 2] At 00:04.125, (S1,S2) says <d>[Chinese] 原话</d> <scenetrans> <cutoff> fully_preserved partially_preserved attribute_transfer weak_reference fully_copy partially_copy reference`
  const tokens = tokenizeH3Syntax(text)
  const values = (kind: string) => tokens.filter((token) => token.kind === kind).map((token) => text.slice(token.from, token.to))
  assert.deepEqual(values('section'), [...h3Sections, 'integrated_multimodal_description'])
  assert.deepEqual(values('reference'), ['<Subject 1>', '<Picture 2>', '<Video 3>', '<Audio 4>'])
  assert.deepEqual(values('shot'), ['[Shot 2]'])
  assert.deepEqual(values('time'), ['00:04.125'])
  assert.deepEqual(values('speaker'), ['(S1,S2)'])
  assert.deepEqual(values('directive'), ['<d>[Chinese]', '</d>', '<scenetrans>', '<cutoff>'])
  assert.equal(values('retention').length, 7)
  assert.equal(tokens.some((token) => text.slice(token.from, token.to).includes('原话')), false)
  assert.deepEqual(tokenizeH3Syntax(text), tokens)
})

test('不将不完整或错误编号的标签及正文里的章节名识别为语法', () => {
  assert.deepEqual(tokenizeH3Syntax('正文 summary: <Picture 0> <Subject 01> <picture 1> <Video -1> <Audio 2 [Shot 0] (S0) (S1, S2) 00:61.001 <unknown>'), [])
})

test('粗体拆分、硬换行、列表和既有原子引用不破坏高亮的位置或保存内容', () => {
  const document = schema.node('doc', null, [
    schema.node('heading', null, schema.text('summary:')),
    schema.node('bulletList', null, schema.node('listItem', null, schema.node('paragraph', null, [
      schema.text('<Pic', [schema.mark('bold')]), schema.text('ture 1>'),
      schema.node('hardBreak'), schema.text('detailed_description:'),
      schema.node('hardBreak'), schema.text('<Video'), schema.node('hardBreak'), schema.text(' 1>'),
      schema.node('promptReference', { label: '<Audio 1>' }), schema.text(' [Shot 1]')
    ])))
  ])
  const original = document.toJSON()
  const plugin = createH3SyntaxPlugin()
  const state = EditorState.create({ doc: document, plugins: [plugin] })
  const decorations = plugin.getState(state)?.find() ?? []
  assert.deepEqual(decorations.map((decoration) => document.textBetween(decoration.from, decoration.to)), [
    'summary', '<Picture 1>', 'detailed_description', '[Shot 1]'
  ])
  assert.deepEqual(state.doc.toJSON(), original)
  const reloaded = EditorState.create({ doc: schema.nodeFromJSON(original), plugins: [plugin] })
  assert.deepEqual(plugin.getState(reloaded)?.find().map(({ from, to }) => [from, to]), decorations.map(({ from, to }) => [from, to]))
})

test('编辑、删除、撤销与重做时自动更新高亮，不向富文本写入新节点或标记', () => {
  const plugin = createH3SyntaxPlugin()
  let state = EditorState.create({
    doc: schema.node('doc', null, schema.node('paragraph')),
    plugins: [plugin, history()]
  })
  const original = state.doc.toJSON()
  state = state.apply(state.tr.insertText('<Picture 1>'))
  assert.equal(plugin.getState(state)?.find().length, 1)
  const inserted = state.doc.toJSON()
  assert.equal(undo(state, (transaction) => { state = state.apply(transaction) }), true)
  assert.deepEqual(state.doc.toJSON(), original)
  assert.equal(plugin.getState(state)?.find().length, 0)
  assert.equal(redo(state, (transaction) => { state = state.apply(transaction) }), true)
  assert.deepEqual(state.doc.toJSON(), inserted)
  assert.equal(plugin.getState(state)?.find().length, 1)
  state = state.apply(state.tr.delete(11, 12))
  assert.equal(plugin.getState(state)?.find().length, 0)
})

test('中文及表情前缀按 ProseMirror 的 UTF-16 偏移定位，不跨越引用原子匹配', () => {
  const prefix = '中文\uD83D\uDE00 '
  const plugin = createH3SyntaxPlugin()
  const state = EditorState.create({
    doc: schema.node('doc', null, schema.node('paragraph', null, [
      schema.text(`${prefix}<Picture 2> <Vid`),
      schema.node('promptReference', { label: '<Picture 1>' }), schema.text('eo 1>')
    ])),
    plugins: [plugin]
  })
  assert.deepEqual(plugin.getState(state)?.find().map(({ from, to }) => [from, to]), [[prefix.length + 1, prefix.length + 12]])
})

test('三节格式可高亮但不冒充全能参考校验通过；完整六节仍按原有规则校验', () => {
  const base = 'integrated_multimodal_description: [Shot 1] Example.\noverall_soundscape: N/A\nnon_diegetic_music: N/A'
  const result = h3PromptSchema.safeParse(base)
  assert.equal(result.success, false)
  if (!result.success) assert.match(result.error.issues[0]?.message ?? '', /三节格式/)
  const full = h3Sections.map((section) => `${section}: Example.`).join('\n')
  assert.equal(h3PromptSchema.safeParse(full).success, true)
  assert.equal(h3PromptSchema.safeParse('').success, false)
  assert.equal(h3PromptSchema.safeParse([...h3Sections].reverse().map((section) => `${section}: Example.`).join('\n')).success, false)
})

test('旧编辑器补挂高亮插件保留文档、选择和撤销历史，重复挂载不产生重复插件', () => {
  const stalePlugin = new Plugin({ key: new PluginKey('h3Syntax') })
  let state = EditorState.create({
    doc: schema.node('doc', null, schema.node('paragraph')),
    plugins: [stalePlugin, history()]
  })
  state = state.apply(state.tr.insertText('<Picture 1> [Shot 1]'))
  const original = state.doc.toJSON()
  const selection = state.selection.toJSON()
  let registrations = 0
  const editor: Parameters<typeof ensureH3SyntaxPlugin>[0] = {
    get state() { return state },
    unregisterPlugin(name) {
      assert.equal(name, 'h3Syntax')
      state = state.reconfigure({ plugins: state.plugins.filter((plugin) => plugin !== stalePlugin) })
      return state
    },
    registerPlugin(plugin) {
      registrations++
      state = state.reconfigure({ plugins: [...state.plugins, plugin] })
      return state
    }
  }
  assert.equal(h3SyntaxPluginKey.getState(state), undefined)
  ensureH3SyntaxPlugin(editor)
  assert.equal(h3SyntaxPluginKey.getState(state)?.find().length, 2)
  assert.deepEqual(state.doc.toJSON(), original)
  assert.deepEqual(state.selection.toJSON(), selection)
  ensureH3SyntaxPlugin(editor)
  assert.equal(registrations, 1)
  assert.equal(undo(state, (transaction) => { state = state.apply(transaction) }), true)
  assert.equal(state.doc.textContent, '')
  assert.equal(h3SyntaxPluginKey.getState(state)?.find().length, 0)
})
