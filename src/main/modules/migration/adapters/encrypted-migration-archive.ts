import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { safeStorage } from 'electron'
import * as tar from 'tar'
import { z } from 'zod'
import type { MigrationArchive } from '../ports/migration'

const magic = Buffer.from('AVWMIG01')
const manifestSchema = z.object({ format: z.literal('ai-video-workbench'), version: z.literal(1), schema: z.number().int(),
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(100000) })
const emptyExemptions = new Set(['workspace_meta', 'app_preferences', 'media_storage_settings', 'asset_mcp_preferences', 'asset_mcp_credential', 'continuity_engine'])
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row.name))
const schema = (db: DatabaseSync) => JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all())
const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()?.user_version)
const absent = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

function validPath(path: string): boolean {
  return path.length < 2000 && !path.includes('\\') && !path.split('/').some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) &&
    (path === 'snapshot.sqlite' || path === 'manifest.json' || /^(media\/(assets|sampling|production-staging)|extensions)(\/|$)/.test(path))
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
    (error, key) => error ? reject(new Error('迁移密码处理失败')) : resolve(key)))
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function inventory(root: string, prefix = '', checkNames = true): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const result: Array<{ path: string; size: number; sha256: string }> = []
  async function visit(name: string, depth: number): Promise<void> {
    if (depth > 32 || result.length >= 100000) throw new Error('迁移文件数量或层级超出限制')
    const path = join(root, name)
    let info
    try { info = await lstat(path) } catch (error) { if (absent(error)) return; throw error }
    if (info.isSymbolicLink()) throw new Error('迁移不允许符号链接或目录联接')
    if (info.isDirectory()) { for (const entry of await readdir(path)) await visit(join(name, entry), depth + 1) }
    else if (info.isFile()) {
      const portable = name.split(sep).join('/')
      if (checkNames && !validPath(portable)) throw new Error('迁移包含不兼容的文件名')
      result.push({ path: portable, size: info.size, sha256: await digest(path) })
    } else throw new Error('迁移包含特殊文件')
  }
  await visit(prefix, 0)
  return result
}

// 系统密钥仅在内存解密，临时数据库里也只写密码派生密钥加密后的密文。
function transformSecrets(db: DatabaseSync, key: Buffer, exporting: boolean): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法迁移 Key')
  const transform = (value: unknown): Buffer => {
    if (!(value instanceof Uint8Array)) throw new Error('凭据记录损坏')
    const buffer = Buffer.from(value)
    if (exporting) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce)
      const encrypted = Buffer.concat([cipher.update(safeStorage.decryptString(buffer), 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
    }
    if (buffer.length < 28) throw new Error('迁移凭据损坏')
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
    decipher.setAuthTag(buffer.subarray(12, 28))
    return safeStorage.encryptString(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8'))
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of db.prepare('SELECT id, key_cipher FROM accounts').all()) db.prepare('UPDATE accounts SET key_cipher=? WHERE id=?').run(transform(row.key_cipher), row.id as SQLInputValue)
    for (const row of db.prepare('SELECT extension_id, key, cipher FROM extension_secrets').all()) db.prepare('UPDATE extension_secrets SET cipher=? WHERE extension_id=? AND key=?').run(transform(row.cipher), row.extension_id as SQLInputValue, row.key as SQLInputValue)
    if (tables(db).includes('image_accounts')) {
      for (const row of db.prepare('SELECT id, cipher FROM image_accounts').all()) db.prepare('UPDATE image_accounts SET cipher=? WHERE id=?').run(transform(row.cipher), row.id as SQLInputValue)
    }
    if (tables(db).includes('image_outputs')) {
      for (const row of db.prepare('SELECT node_id, cipher FROM image_outputs').all()) db.prepare('UPDATE image_outputs SET cipher=? WHERE node_id=?').run(transform(row.cipher), row.node_id as SQLInputValue)
    }
    // 迁移不延续令牌、目录授权和插件自动执行权限。
    db.exec("DELETE FROM asset_mcp_credential; DELETE FROM asset_mcp_preferences; DELETE FROM media_storage_settings; DELETE FROM continuity_engine; UPDATE extensions SET data=json_set(data, '$.enabled', json('false'));")
    db.exec("UPDATE app_preferences SET data=json_set(data, '$.mcpAutoStart', json('false')); COMMIT;")
  } catch { db.exec('ROLLBACK'); throw new Error('凭据转换失败，请在原电脑核对 Key 或检查迁移密码') }
}

export class EncryptedMigrationArchive implements MigrationArchive {
  constructor(private readonly database: DatabaseSync, private readonly dataDirectory: string, private readonly mediaDirectory: string) {}
  assertEmpty(): void {
    for (const table of tables(this.database)) if (!emptyExemptions.has(table) && this.database.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get()) {
      throw new Error('仅允许导入空工作台；当前已有项目、素材、账号、任务或历史数据，未覆盖任何内容')
    }
  }
  async exportTo(path: string, password: string): Promise<void> {
    const staging = await mkdtemp(join(this.dataDirectory, 'migration-export-'))
    const partial = join(dirname(path), `.migration-${randomUUID()}.partial`)
    const salt = randomBytes(16), nonce = randomBytes(12), header = Buffer.concat([magic, salt, nonce])
    const key = await derive(password, salt)
    try {
      const snapshot = join(staging, 'snapshot.sqlite')
      this.database.prepare('VACUUM INTO ?').run(snapshot)
      const copied = new DatabaseSync(snapshot)
      try { copied.exec('PRAGMA secure_delete=ON'); transformSecrets(copied, key, true); copied.exec('VACUUM') } finally { copied.close() }
      for (const folder of ['assets', 'sampling', 'production-staging']) await this.copyFolder(join(this.mediaDirectory, folder), join(staging, 'media', folder), `media/${folder}`)
      await this.copyFolder(join(this.dataDirectory, 'extensions'), join(staging, 'extensions'), 'extensions')
      const files = await inventory(staging)
      await writeFile(join(staging, 'manifest.json'), JSON.stringify({ format: 'ai-video-workbench', version: 1, schema: version(this.database), files }))
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(header)
      const output = createWriteStream(partial, { flags: 'wx' })
      output.write(header)
      await pipeline(tar.c({ cwd: staging, gzip: true, portable: true, noMtime: true }, [...files.map((file) => file.path), 'manifest.json']), cipher, output)
      await appendFile(partial, cipher.getAuthTag())
      await rename(partial, path)
    } finally {
      key.fill(0)
      await rm(partial, { force: true })
      await rm(staging, { recursive: true, force: true })
    }
  }
  private async copyFolder(source: string, target: string, prefix: string): Promise<void> {
    try { await lstat(source) } catch (error) { if (absent(error)) return; throw error }
    // 先逐文件检查，不跟随源目录内的链接；校验后的快照再次纳入完整性清单。
    const entries = await inventory(dirname(source), relative(dirname(source), source), false)
    for (const entry of entries) {
      const local = entry.path.split('/').slice(1).join('/')
      if (!validPath(`${prefix}/${local}`)) throw new Error('迁移文件名不兼容')
      await mkdir(dirname(join(target, local)), { recursive: true })
      await cp(join(source, local), join(target, local), { errorOnExist: true, force: false })
    }
  }
  async importFrom(path: string, password: string): Promise<void> {
    this.assertEmpty()
    const staging = await mkdtemp(join(this.dataDirectory, 'migration-import-'))
    const restoredMedia = join(this.dataDirectory, `restored-media-${randomUUID()}`)
    const extensionTarget = join(this.dataDirectory, 'extensions')
    let extensionsMoved = false, committed = false
    let key: Buffer | undefined
    try {
      const input = await open(path, 'r')
      const header = Buffer.alloc(36), tag = Buffer.alloc(16)
      let size: number
      try {
        size = (await input.stat()).size
        if (size < 53 || (await input.read(header, 0, 36, 0)).bytesRead !== 36 || !header.subarray(0, 8).equals(magic)) throw new Error('不支持的迁移包格式')
        await input.read(tag, 0, 16, size - 16)
      } finally { await input.close() }
      key = await derive(password, header.subarray(8, 24))
      const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(24))
      decipher.setAAD(header); decipher.setAuthTag(tag)
      const archive = join(staging, 'payload.tgz'), extracted = join(staging, 'extracted')
      try { await pipeline(createReadStream(path, { start: 36, end: size - 17 }), decipher, createWriteStream(archive, { flags: 'wx' })) }
      catch { throw new Error('迁移包密码不正确、文件损坏或磁盘空间不足，未导入') }
      await mkdir(extracted)
      const disk = await statfs(staging), available = disk.bavail * disk.bsize
      let bytes = 0, count = 0, archiveError = ''
      const names = new Set<string>()
      await tar.t({ file: archive, strict: true, onReadEntry: (entry) => {
        const name = entry.path.replace(/\/$/, '')
        if (archiveError) return
        if (!validPath(name) || !['File', 'Directory'].includes(entry.type) || names.has(name.toLowerCase()) || ++count > 100000) { archiveError = '迁移包包含非法路径、链接或重复文件'; return }
        names.add(name.toLowerCase()); bytes += entry.size
        if (!Number.isSafeInteger(bytes) || bytes * 2 > available) archiveError = '磁盘空间不足，无法安全导入迁移包'
      } })
      if (archiveError) throw new Error(archiveError)
      await tar.x({ file: archive, cwd: extracted, strict: true, preservePaths: false, noChmod: true, noMtime: true })
      const manifestFile = join(extracted, 'manifest.json')
      if ((await lstat(manifestFile)).size > 32 * 1024 * 1024) throw new Error('迁移清单过大')
      const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')) as unknown)
      const files = await inventory(extracted)
      const listed = new Map(manifest.files.map((file) => [file.path, file]))
      if (listed.size !== manifest.files.length || files.length !== listed.size + 1) throw new Error('迁移清单不匹配')
      for (const file of files) if (file.path !== 'manifest.json') {
        const expected = listed.get(file.path)
        if (!expected || expected.size !== file.size || expected.sha256 !== file.sha256) throw new Error('迁移文件完整性校验失败')
      }
      const sourcePath = join(extracted, 'snapshot.sqlite'), source = new DatabaseSync(sourcePath)
      try {
        if (version(source) !== version(this.database) || manifest.schema !== version(source) || schema(source) !== schema(this.database)) throw new Error('迁移包数据库版本或结构与当前应用不匹配，请使用相同版本应用')
        if (source.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('迁移数据库校验失败')
        transformSecrets(source, key, false)
        source.prepare('INSERT INTO media_storage_settings(singleton, data) VALUES (1, ?)').run(JSON.stringify({ directory: restoredMedia, pendingDirectory: null, cleanupDirectory: null }))
        // 媒体引擎路径属于旧电脑，目标电脑重新使用随包引擎。
        source.exec('DELETE FROM continuity_engine')
      } finally { source.close() }
      this.assertEmpty()
      try { if ((await readdir(extensionTarget)).length) throw new Error('目标电脑的插件目录非空，未覆盖') } catch (error) { if (!absent(error)) throw error }
      await mkdir(restoredMedia)
      try { await cp(join(extracted, 'media'), restoredMedia, { recursive: true, force: false, errorOnExist: true }) } catch (error) { if (!absent(error)) throw error }
      try {
        await lstat(join(extracted, 'extensions'))
        try { await rmdir(extensionTarget) } catch (error) { if (!absent(error)) throw error }
        await rename(join(extracted, 'extensions'), extensionTarget); extensionsMoved = true
      } catch (error) { if (!absent(error)) throw error }
      this.database.prepare('ATTACH DATABASE ? AS migration_source').run(sourcePath)
      this.database.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
      try {
        for (const table of tables(this.database)) {
          this.database.exec(`DELETE FROM main.${quote(table)}; INSERT INTO main.${quote(table)} SELECT * FROM migration_source.${quote(table)}`)
        }
        if (this.database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('迁移数据库引用校验失败')
        this.database.exec('COMMIT'); committed = true
      } catch (error) { this.database.exec('ROLLBACK'); throw error }
      finally {
        try { this.database.exec('DETACH DATABASE migration_source') } catch (error) { if (!committed) throw error }
        this.database.exec('PRAGMA foreign_keys=ON')
      }
    } finally {
      key?.fill(0)
      if (!committed) {
        await rm(restoredMedia, { recursive: true, force: true })
        if (extensionsMoved) await rm(extensionTarget, { recursive: true, force: true })
      }
      // 已提交后清理失败不能对用户报告“未导入”，否则会在旧媒体服务上继续操作。
      try { await rm(staging, { recursive: true, force: true }) } catch (error) { if (!committed) throw error }
    }
  }
}
