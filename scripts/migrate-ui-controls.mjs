import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from '@babel/parser'

const root = 'src/renderer/src'
const shared = {
  input: ['Input', 'input'], textarea: ['Textarea', 'textarea'], select: ['SelectField', 'select-field'],
  button: ['Button', 'button'], details: ['Disclosure', 'disclosure'], option: ['SelectOption', 'select-field'],
  table: ['Table', 'table'], thead: ['TableHeader', 'table'], tbody: ['TableBody', 'table'],
  tr: ['TableRow', 'table'], th: ['TableHead', 'table'], td: ['TableCell', 'table']
}

async function migrate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { if (path.replaceAll('\\', '/').endsWith('/components/ui')) continue; await migrate(path); continue }
    if (!path.endsWith('.tsx')) continue
    const source = await readFile(path, 'utf8')
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const edits = []
    const imports = new Map()
    function visit(node) {
      if (node.type === 'JSXOpeningElement' || node.type === 'JSXClosingElement') {
        const tag = node.name.name
        let replacement = shared[tag]
        if (tag === 'input' && node.type === 'JSXOpeningElement') {
          const type = node.attributes.find((item) => item.type === 'JSXAttribute' && item.name.name === 'type')
          if (type?.value?.type === 'StringLiteral' && type.value.value === 'checkbox') {
            replacement = ['CheckboxField', 'checkbox-field']
            edits.push({ start: type.start, end: type.end, text: '' })
          }
        }
        if (replacement) {
          const [name, module] = replacement
          edits.push({ start: node.name.start, end: node.name.end, text: name })
          if (!source.includes(`import { ${name} } from '@/components/ui/${module}'`)) {
            const names = imports.get(module) ?? new Set()
            names.add(name); imports.set(module, names)
          }
          if (tag === 'button' && node.type === 'JSXOpeningElement') edits.push({ start: node.name.end, end: node.name.end, text: ' variant="unstyled"' })
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') visit(child) }
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
      }
    }
    visit(ast)
    if (!edits.length) continue
    let updated = source
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end)
    const prefix = [...imports].map(([module, names]) => `import { ${[...names].join(', ')} } from '@/components/ui/${module}'`).join('\n')
    await writeFile(path, (prefix ? prefix + '\n' : '') + updated)
    process.stdout.write(path + '\n')
  }
}

await migrate(root)
