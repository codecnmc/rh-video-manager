const nodeTypes = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'promptReference'])
const markTypes = new Set(['bold', 'italic', 'strike', 'code'])
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function validPromptDocument(value: string): boolean {
  if (!value) return true
  try {
    const root: unknown = JSON.parse(value)
    if (!record(root) || root.type !== 'doc') return false
    const pending: { node: unknown; depth: number }[] = [{ node: root, depth: 0 }]
    let count = 0
    while (pending.length) {
      const entry = pending.pop()
      if (!entry || ++count > 10000 || entry.depth > 30) return false
      const node = entry.node
      if (!record(node) || typeof node.type !== 'string' || !nodeTypes.has(node.type)) return false
      if (node.type === 'text' && (typeof node.text !== 'string' || node.text.length > 50000)) return false
      if (node.type === 'promptReference' && (!record(node.attrs) || typeof node.attrs.label !== 'string' || !/^<(Picture|Video|Audio|Subject) [1-9]\d*>$/.test(node.attrs.label))) return false
      if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some((mark: unknown) => !record(mark) || typeof mark.type !== 'string' || !markTypes.has(mark.type)))) return false
      if (node.content !== undefined) {
        if (!Array.isArray(node.content)) return false
        for (const child of node.content) pending.push({ node: child, depth: entry.depth + 1 })
      }
    }
    return true
  } catch { return false }
}
