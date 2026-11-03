import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseExtensionManifest, type ExtensionPackages, type ExtensionRecord } from '../../modules/extensions'

const packageKeySchema = z.string().uuid()
const maximumBytes = 32 * 1024 * 1024
const maximumFiles = 2000

async function packageFiles(directory: string): Promise<Map<string, Buffer>> {
  const root = await realpath(directory)
  const files = new Map<string, Buffer>()
  let total = 0
  let visited = 0
  async function visit(path: string, depth: number): Promise<void> {
    if (++visited > 4000) throw new Error('插件包目录与文件总数过多')
    if (depth > 12) throw new Error('插件包目录层级过深')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('插件包不能包含符号链接或目录联接')
    const resolved = await realpath(path)
    const local = relative(root, resolved)
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('插件包文件越过目录边界')
    if (stat.isDirectory()) {
      const entries = await readdir(path)
      if (entries.length > maximumFiles) throw new Error('插件包文件数量过多')
      for (const entry of entries.sort()) {
        if (entry === '.git' || entry === '.codegraph') throw new Error('请选择已打包的插件目录，不要选择源码仓库')
        await visit(join(path, entry), depth + 1)
      }
    } else if (stat.isFile()) {
      if (files.size >= maximumFiles || total + stat.size > maximumBytes) throw new Error('插件包超过 2000 文件或 32 MiB 上限，模型应独立存放')
      const bytes = await readFile(path)
      total += bytes.length
      if (total > maximumBytes) throw new Error('插件包体积过大')
      files.set(local.split(sep).join('/'), bytes)
    } else throw new Error('插件包包含不支持的文件类型')
  }
  await visit(directory, 0)
  return files
}

function digest(files: Map<string, Buffer>): string {
  const hash = createHash('sha256')
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    hash.update(JSON.stringify([name, bytes.length])).update(bytes)
  }
  return hash.digest('hex')
}

export class ManagedExtensionPackages implements ExtensionPackages {
  private readonly root: string
  constructor(directory: string) { this.root = resolve(directory) }
  private path(key: string): string { return join(this.root, packageKeySchema.parse(key)) }
  async stage(directory: string) {
    const files = await packageFiles(directory)
    const rawManifest = files.get('extension.json')
    if (!rawManifest || rawManifest.length > 64 * 1024) throw new Error('插件包缺少有效的 extension.json')
    let input: unknown
    try { input = JSON.parse(rawManifest.toString('utf8')) } catch { throw new Error('插件清单不是有效 JSON') }
    const manifest = parseExtensionManifest(input)
    if (!files.has(manifest.main.slice(2))) throw new Error('插件入口文件不存在')
    const packageKey = randomUUID()
    const target = this.path(packageKey)
    await mkdir(target, { recursive: true })
    try {
      // 从已读取的快照复制，信任确认后的内容与执行内容必须一致。
      for (const [name, bytes] of files) {
        const path = join(target, ...name.split('/'))
        await mkdir(resolve(path, '..'), { recursive: true })
        await writeFile(path, bytes, { flag: 'wx' })
      }
      return { manifest, packageKey, digest: digest(files) }
    } catch (error) { await this.discard(packageKey); throw error }
  }
  async verify(record: ExtensionRecord): Promise<void> {
    let actual: string
    try { actual = digest(await packageFiles(this.path(record.packageKey))) }
    catch { throw new Error('插件包缺失或不可读取，请重新安装') }
    if (actual !== record.digest) throw new Error('插件包安装后已被修改，请停用并重新安装')
  }
  async discard(packageKey: string): Promise<void> {
    // 只清理本次未安装成功的 UUID 暂存目录；卸载不会调用这里。
    await rm(this.path(packageKey), { recursive: true, force: true })
  }
}
