import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = resolve(process.argv[2] ?? join(root, '.cache/local-tts/runtime-win-x64-v1'))
const metadata = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'))
if (metadata.runtimeVersion !== 1 || metadata.platform !== 'win32-x64') throw new Error('Runtime is not ready')
const delivery = join(root, 'release/plugin-support')
await mkdir(delivery, { recursive: true })
// 只更新交付副本，不改动 userData 下已经安装的不可变插件包。
await cp(join(root, 'extensions/kokoro-test'), join(delivery, 'kokoro-test'), { recursive: true })
await cp(runtime, join(delivery, 'runtime'), { recursive: true })
await writeFile(join(delivery, '安装说明.md'), await readFile(join(root, 'extensions/kokoro-test/README.md')))
console.log(`Plugin: ${join(delivery, 'kokoro-test')}`)
console.log(`Runtime setting: ${join(delivery, 'runtime')}`)
