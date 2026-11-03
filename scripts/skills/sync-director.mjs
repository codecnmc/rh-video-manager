import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'

const source = resolve(process.argv[2] || '')
if (!process.argv[2] || !source.endsWith('director-workbench')) throw new Error('请指定 director-workbench 技能目录')
const target = resolve('resources/skills/director-workbench')
let copied = 0
async function visit(relative = '') {
  for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
    const local = join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error('技能源目录含链接')
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== '__pycache__' && !['outputs', 'output', 'node_modules'].includes(entry.name)) await visit(local)
      continue
    }
    if (entry.name === 'image-providers.example.json') continue
    if (!(/\.(md|py|yaml|json|txt|csv|edl)$/.test(entry.name) || entry.name === 'LICENSE')) continue
    if (/image-providers\.json$|jobs\.json$|key|secret|credential|\.env/i.test(entry.name)) throw new Error(`禁止分发私有配置: ${local}`)
    const bytes = await readFile(join(source, local))
    if (/sk-[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9_-]{24,}/.test(bytes.toString('utf8'))) throw new Error(`技能文件含疑似凭据，未复制: ${local}`)
    await mkdir(dirname(join(target, local)), { recursive: true })
    await cp(join(source, local), join(target, local), { force: false, errorOnExist: true })
    copied++
  }
}
await visit()
process.stdout.write(`Copied ${copied} clean skill resources. Private config, runtime state and caches excluded.\n`)
