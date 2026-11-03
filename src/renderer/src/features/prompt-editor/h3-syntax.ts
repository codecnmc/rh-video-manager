import { Extension, type Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const syntaxKinds = ['section', 'reference', 'shot', 'speaker', 'time', 'directive', 'retention'] as const
type SyntaxKind = typeof syntaxKinds[number]
export const h3SyntaxPluginKey = new PluginKey<DecorationSet>('h3Syntax')

interface SyntaxToken {
  from: number
  to: number
  kind: SyntaxKind
}

export function tokenizeH3Syntax(text: string): SyntaxToken[] {
  // 三节格式也可高亮，但不代表它通过当前全能参考的六节校验。
  const pattern = /(?<section>^[ \t]*(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)(?=[ \t]*:))|(?<reference><(?:Picture|Video|Audio|Subject) [1-9]\d*>)|(?<shot>\[Shot [1-9]\d*\])|(?<speaker>\(S[1-9]\d*(?:,S[1-9]\d*)*\))|(?<time>\b\d{2}:[0-5]\d\.\d{3}\b)|(?<directive><d>(?:\[[A-Za-z][A-Za-z -]*\])?|<\/d>|<scenetrans>|<cutoff>)|(?<retention>\b(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b)/gm
  const tokens: SyntaxToken[] = []
  for (const match of text.matchAll(pattern)) {
    const kind = syntaxKinds.find((candidate) => match.groups?.[candidate] !== undefined)
    if (kind) tokens.push({ from: match.index, to: match.index + match[0].length, kind })
  }
  return tokens
}

function decorateH3Syntax(document: Node): DecorationSet {
  const decorations: Decoration[] = []
  document.descendants((node, position) => {
    if (!node.isTextblock) return
    // 合并被粗体等标记拆开的文字；硬换行保留行首语义，原子引用占位但不跨越匹配。
    let text = ''
    node.forEach((child) => {
      text += child.isText ? child.text ?? '' : child.type.name === 'hardBreak' ? '\n' : '\uFFFC'.repeat(child.nodeSize)
    })
    for (const token of tokenizeH3Syntax(text)) {
      decorations.push(Decoration.inline(position + 1 + token.from, position + 1 + token.to, { class: `prompt-syntax-${token.kind}` }))
    }
    return false
  })
  return DecorationSet.create(document, decorations)
}

export function createH3SyntaxPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: h3SyntaxPluginKey,
    state: {
      init: (_, state) => decorateH3Syntax(state.doc),
      apply: (transaction, decorations) => transaction.docChanged ? decorateH3Syntax(transaction.doc) : decorations
    },
    props: { decorations: (state) => h3SyntaxPluginKey.getState(state) ?? null }
  })
}

export function ensureH3SyntaxPlugin(editor: Pick<Editor, 'state' | 'unregisterPlugin' | 'registerPlugin'>): void {
  if (h3SyntaxPluginKey.getState(editor.state) !== undefined) return
  // 热更新的 setOptions 不重建扩展；替换旧插件，不重建文档或清空撤销历史。
  editor.unregisterPlugin('h3Syntax')
  editor.registerPlugin(createH3SyntaxPlugin())
}

export const H3Syntax = Extension.create({
  name: 'h3Syntax',
  addProseMirrorPlugins() { return [createH3SyntaxPlugin()] }
})
