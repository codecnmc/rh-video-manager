import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDirectory, '../..')
const require = createRequire(import.meta.url)

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

export async function prepareMediaEngine() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Bundled media engine currently supports Windows x64 only')
  const pins = JSON.parse(await readFile(join(scriptDirectory, 'win32-x64.json'), 'utf8'))
  const packageDirectory = dirname(require.resolve(`${pins.package}/package.json`))
  const metadata = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
  if (metadata.version !== pins.packageVersion || metadata['ffmpeg-static']?.['binary-release-tag'] !== pins.release) {
    throw new Error('Media engine dependency does not match the pinned release')
  }
  // 下载只由依赖安装阶段完成；装配不接受环境变量替换版本，也不临时联网补文件。
  for (const [name, expected] of Object.entries(pins.files)) {
    const binary = join(packageDirectory, name)
    if (!await stat(binary).then((file) => file.isFile(), () => false)) throw new Error(`Missing ${name}; reinstall the pinned dependency with install scripts enabled`)
    if (await sha256(binary) !== expected) throw new Error(`Bundled ${name} checksum mismatch; refusing to package it`)
  }
  const license = await readFile(join(packageDirectory, 'ffmpeg.exe.LICENSE'), 'utf8')
  if (!license.includes('GNU GENERAL PUBLIC LICENSE') || !license.includes('Version 3')) throw new Error('FFmpeg GPLv3 license is missing or invalid')
  const destination = join(root, 'resources/media-engine/win32-x64')
  await mkdir(destination, { recursive: true })
  const files = [
    ...Object.keys(pins.files).map((name) => [join(packageDirectory, name), name]),
    [join(packageDirectory, 'ffmpeg.exe.LICENSE'), 'FFMPEG-LICENSE.txt'],
    [join(packageDirectory, 'LICENSE'), 'DEPENDENCY-LICENSE.txt'],
    [join(root, 'resources/notices/media-engine.md'), 'NOTICE.md'],
    [join(scriptDirectory, 'win32-x64.json'), 'manifest.json']
  ]
  for (const [source, name] of files) {
    const target = join(destination, name)
    const unchanged = await stat(target).then(async (file) => file.isFile() && await sha256(source) === await sha256(target), () => false)
    if (unchanged) continue
    const temporary = join(destination, `${name}.${randomUUID()}.part`)
    try {
      await copyFile(source, temporary)
      await rename(temporary, target)
    } finally {
      // temporary 是固定受管资源目录内、本次创建的独立文件，不清理用户目录。
      await rm(temporary, { force: true })
    }
  }
  console.log(`Media engine ready: ${pins.binaryVersion} (Windows x64)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareMediaEngine()
}
