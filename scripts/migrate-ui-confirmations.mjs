import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from '@babel/parser'

async function migrate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { if (path.replaceAll('\\', '/').endsWith('/components/ui')) continue; await migrate(path); continue }
    if (!/\.tsx?$/.test(path)) continue
    const source = await readFile(path, 'utf8')
    if (!source.includes('window.confirm')) continue
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const edits = []
    const owners = new Set()
    function visit(node, owner) {
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) owner = node
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'window' && node.callee.property.name === 'confirm') {
        if (!owner) throw new Error(`确认框缺少函数宿主: ${path}`)
        edits.push({ start: node.callee.start, end: node.callee.end, text: '(await confirmAction' }, { start: node.end, end: node.end, text: ')' })
        if (!owner.async && !owners.has(owner.start)) { edits.push({ start: owner.start, end: owner.start, text: 'async ' }); owners.add(owner.start) }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') visit(child, owner) }
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value, owner)
      }
    }
    visit(ast)
    let updated = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end)
    await writeFile(path, "import { confirmAction } from '@/components/ui/confirmation'\n" + updated)
    process.stdout.write(path + '\n')
  }
}

await migrate('src/renderer/src')
