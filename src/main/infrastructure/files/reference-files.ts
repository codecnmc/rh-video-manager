import { basename, extname, join, relative, isAbsolute, sep } from 'node:path'
import { constants } from 'node:fs'
import { copyFile, mkdir, open, stat, unlink, realpath, lstat } from 'node:fs/promises'
import { shell } from 'electron'
import type { AssetFiles } from '../../modules/assets'
import { pastedImageSchema, type PastedImage, type ReferenceKind } from '../../../shared/contracts/references'
import { assetMediaExtensions } from '../../../shared/contracts/assets'

export const referenceExtensions = assetMediaExtensions
const maxBytes = { image: 10 * 1024 * 1024, video: 200 * 1024 * 1024, audio: 50 * 1024 * 1024 }

export class ManagedReferenceFiles implements AssetFiles {
  constructor(private readonly directory: string) {}
  resolve(storedName: string): string {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(storedName)) throw new Error('素材路径不正确')
    return join(this.directory, storedName)
  }
  async localPath(storedName: string) {
    const path = this.resolve(storedName)
    const root = await realpath(this.directory)
    const target = await realpath(path)
    const local = relative(root, target)
    const info = await lstat(path)
    // 只交付受管目录中的真实媒体文件，不能借文件链接暴露目录外路径。
    if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || info.isSymbolicLink() || !info.isFile()) {
      throw new Error('素材文件不在受管目录或不是普通文件')
    }
    if (info.size < 1) throw new Error('素材文件为空')
    return { path: target, size: info.size }
  }
  async readImage(storedName: string) {
    const path = this.resolve(storedName)
    const extension = extname(storedName).slice(1)
    if (!referenceExtensions.image.includes(extension)) throw new Error('不支持的图片格式')
    const root = await realpath(this.directory)
    const target = await realpath(path)
    const local = relative(root, target)
    if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || (await lstat(path)).isSymbolicLink()) throw new Error('图片不在受管目录')
    const file = await open(path, 'r')
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size < 1 || before.size > maxBytes.image) throw new Error('图片为空或超过大小上限')
      // 固定上限缓冲区，避免文件在读取期间增长导致无界内存占用。
      const bytes = Buffer.alloc(before.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      const after = await file.stat()
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('图片在读取时发生变化')
      const data = bytes.subarray(0, length)
      const valid = extension === 'png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : extension === 'jpg' || extension === 'jpeg' ? data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
          : data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
      if (!valid) throw new Error('图片内容与文件格式不匹配')
      const mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
      return { bytes: data, mimeType }
    } finally { await file.close() }
  }
  async import(id: string, path: string, kind: ReferenceKind) {
    const extension = extname(path).slice(1).toLowerCase()
    if (!referenceExtensions[kind].includes(extension)) throw new Error('素材格式不受支持')
    const info = await stat(path)
    if (!info.isFile() || info.size === 0 || info.size > maxBytes[kind]) throw new Error('素材为空或超过大小上限')
    await mkdir(this.directory, { recursive: true })
    const storedName = `${id}.${extension}`
    const target = this.resolve(storedName)
    let created = false
    try {
      await copyFile(path, target, constants.COPYFILE_EXCL)
      created = true
      const copied = await stat(target)
      if (copied.size !== info.size || copied.size > maxBytes[kind]) throw new Error('素材在导入时发生变化')
      if (kind === 'image') {
        const file = await open(target, 'r')
        const header = Buffer.alloc(12)
        try { await file.read(header, 0, header.length, 0) } finally { await file.close() }
        const valid = extension === 'png' ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : extension === 'jpg' || extension === 'jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255
            : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
        if (!valid) throw new Error('图片内容与文件格式不匹配')
      }
    } catch (error) {
      if (created) await unlink(target).catch(() => undefined)
      throw error
    }
    return { storedName, name: basename(path), size: info.size }
  }
  async importImage(id: string, image: PastedImage) {
    const parsed = pastedImageSchema.parse(image)
    const bytes = Buffer.from(parsed.bytes)
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[parsed.mimeType]
    // 不信任剪贴板声明的类型，拒绝将其他内容伪装成受管图片。
    const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : extension === 'jpg' ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!valid) throw new Error('剪贴板图片内容与格式不匹配')
    await mkdir(this.directory, { recursive: true })
    const storedName = `${id}.${extension}`
    const target = this.resolve(storedName)
    let created = false
    try {
      const file = await open(target, 'wx')
      created = true
      try { await file.writeFile(bytes) } finally { await file.close() }
    } catch (error) {
      if (created) await this.discard(storedName)
      throw error
    }
    const name = `${basename(parsed.name, extname(parsed.name)).slice(0, 140) || '粘贴图片'}.${extension}`
    return { storedName, name, size: bytes.byteLength }
  }
  async discard(storedName: string): Promise<void> { await unlink(this.resolve(storedName)).catch(() => undefined) }
  reveal(storedName: string): void { shell.showItemInFolder(this.resolve(storedName)) }
}
