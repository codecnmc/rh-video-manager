import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, type Stats } from 'node:fs'
import { copyFile, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, statfs, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { MediaStorageFiles } from '../../modules/settings'

const folders = ['assets', 'sampling', 'production-staging'] as const
interface MediaFile { name: string; size: number }

function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
function within(parent: string, child: string): boolean {
  const local = relative(parent, child)
  return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`))
}
function disjoint(source: string, target: string): void {
  if (within(source, target) || within(target, source)) throw new Error('新旧素材位置不能相同或互相包含')
}
async function root(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('素材位置必须是绝对路径')
  const actual = await realpath(path)
  if (actual === parse(actual).root) throw new Error('不能直接使用磁盘根目录作为素材目录')
  if (!(await lstat(actual)).isDirectory()) throw new Error('素材位置不是目录')
  return actual
}
async function hash(path: string): Promise<string> {
  const result = createHash('sha256')
  for await (const chunk of createReadStream(path)) result.update(chunk)
  return result.digest('hex')
}
async function regularFile(path: string): Promise<number> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('素材目录包含链接或特殊文件，未执行迁移')
  return info.size
}
async function directoryWithin(base: string, name: string, create: boolean): Promise<void> {
  const path = join(base, name)
  if (create) {
    try { await mkdir(path) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
  }
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || !within(base, await realpath(path))) throw new Error('目标目录包含链接或特殊文件')
}

async function inventory(directory: string): Promise<{ files: MediaFile[]; directories: string[] }> {
  const files: MediaFile[] = [], directories: string[] = []
  async function visit(name: string, depth: number): Promise<void> {
    if (depth > 32 || files.length + directories.length > 100000) throw new Error('素材目录层级或文件数量超出迁移限制')
    const path = join(directory, name)
    let info: Stats
    try { info = await lstat(path) } catch (error) { if (depth === 0 && missing(error)) return; throw error }
    if (info.isSymbolicLink() || !within(directory, await realpath(path))) throw new Error('素材目录包含链接或越界路径，未执行迁移')
    if (depth === 0 && !info.isDirectory()) throw new Error('素材子目录不是有效文件夹')
    if (info.isDirectory()) {
      directories.push(name)
      for (const entry of await readdir(path)) await visit(join(name, entry), depth + 1)
    } else if (info.isFile()) files.push({ name, size: info.size })
    else throw new Error('素材目录包含特殊文件，未执行迁移')
  }
  for (const folder of folders) await visit(folder, 0)
  return { files, directories }
}

export class LocalMediaStorageFiles implements MediaStorageFiles {
  async allocate(parent: string, source: string): Promise<string> {
    const selected = await realpath(parent)
    if (!(await lstat(selected)).isDirectory()) throw new Error('请选择文件夹')
    // 每次新建独立受管目录，不覆盖用户选择目录中的现有文件。
    disjoint(await root(source), resolve(selected, 'AI-video-workbench-media-new'))
    // 迁移依赖独占硬链接落位；在保存重启计划前检查，避免 exFAT 等磁盘反复迁移失败。
    const probe = await mkdtemp(join(selected, '.workbench-storage-probe-'))
    try {
      await writeFile(join(probe, 'source'), '', { flag: 'wx' })
      await link(join(probe, 'source'), join(probe, 'target'))
    } catch {
      throw new Error('所选目录不支持安全素材迁移所需的硬链接，或没有写入权限。请选择可写的 NTFS 磁盘目录。')
    } finally {
      await unlink(join(probe, 'target')).catch(() => undefined)
      await unlink(join(probe, 'source')).catch(() => undefined)
      await rmdir(probe).catch(() => undefined)
    }
    return mkdtemp(join(selected, 'AI-video-workbench-media-'))
  }

  async copy(source: string, target: string): Promise<void> {
    const from = await root(source), to = await root(target)
    disjoint(from, to)
    const manifest = await inventory(from)
    for (const name of manifest.directories) await directoryWithin(to, name, true)
    // 重启可复用已校验的副本；已有不同内容一律拒绝覆盖。
    const remaining: MediaFile[] = []
    for (const file of manifest.files) {
      try {
        if (await regularFile(join(to, file.name)) !== file.size || await hash(join(from, file.name)) !== await hash(join(to, file.name))) throw new Error('目标目录存在不同内容的文件')
      } catch (error) { if (!missing(error)) throw error; remaining.push(file) }
    }
    const disk = await statfs(to)
    if (remaining.reduce((sum, file) => sum + file.size, 0) > disk.bavail * disk.bsize) throw new Error('目标磁盘空间不足')
    for (const file of remaining) {
      const original = join(from, file.name), copied = join(to, file.name)
      const temporary = `${copied}.${randomUUID()}.migration-part`
      await regularFile(original)
      try {
        await copyFile(original, temporary, constants.COPYFILE_EXCL)
        if (await regularFile(temporary) !== file.size || await hash(original) !== await hash(temporary)) throw new Error('素材副本校验失败')
        const handle = await open(temporary, 'r+')
        try { await handle.sync() } finally { await handle.close() }
        // 临时副本完整后独占落位，进程中断也不会把半个文件视为已完成副本。
        await link(temporary, copied)
      } finally { await unlink(temporary).catch(() => undefined) }
    }
    // 逐文件 SHA-256 核验后才允许切换持久化路径，素材 ID 和相对文件名保持不变。
    for (const file of manifest.files) {
      const original = join(from, file.name), copied = join(to, file.name)
      if (await regularFile(original) !== file.size || await regularFile(copied) !== file.size || await hash(original) !== await hash(copied)) throw new Error('素材副本校验失败')
    }
  }

  async cleanup(source: string, target: string): Promise<void> {
    const from = await root(source), to = await root(target)
    disjoint(from, to)
    const manifest = await inventory(from)
    for (const name of manifest.directories) await directoryWithin(to, name, false)
    // 不递归删除旧根目录；只逐个删除仍与新位置相同的副本，数据库、日志和插件不受影响。
    for (const file of manifest.files) {
      const original = join(from, file.name), copied = join(to, file.name)
      if (await regularFile(copied) !== await regularFile(original) || await hash(original) !== await hash(copied)) throw new Error('旧副本已变化或新副本不可读取，未删除该文件')
      await unlink(original)
    }
    for (const name of manifest.directories.reverse()) await rmdir(join(from, name))
  }
}
