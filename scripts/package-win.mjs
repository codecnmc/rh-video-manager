import { build, Platform, Arch } from 'electron-builder'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
if (!['empty', 'current', 'release'].includes(mode)) throw new Error('Usage: node scripts/package-win.mjs empty|current|release')
const metadataSource = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (mode === 'release' && !/^\d+\.\d+\.\d+$/.test(metadataSource.version)) throw new Error('Release requires a stable X.Y.Z version')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { getPath7za } = libraryRequire('./toolsets/7zip')
const path7za = await getPath7za()
const id = randomUUID()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const name = mode === 'release' ? `rh-video-manager-${metadataSource.version}-win-x64`
  : `ai-video-workbench-${mode === 'current' ? 'current-data' : 'empty'}-${stamp}`
// 正式版本使用固定 profile，升级不创建随机空白目录；打包不读取或复制用户数据。
const profile = mode === 'empty' ? `empty-${id}` : 'current'
const output = join(root, 'release', name)
await mkdir(output, { recursive: true })
await build({
  targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
  config: {
    directories: { output },
    extraMetadata: { workbenchDataProfile: profile }
  }
})
const unpacked = join(output, 'win-unpacked')
const { extractFile } = libraryRequire('@electron/asar')
const metadata = JSON.parse(extractFile(join(unpacked, 'resources/app.asar'), 'package.json').toString('utf8'))
if (metadata.workbenchDataProfile !== profile) throw new Error('Packaged data profile mismatch')
for (const file of ['羊驼AI影视.exe', 'resources/app.asar.unpacked/out/main/extension-host.js',
  'resources/alpaca.ico', 'resources/alpaca.png',
  'resources/media-engine/win32-x64/ffmpeg.exe', 'resources/media-engine/win32-x64/ffprobe.exe',
  'resources/LICENSE', 'resources/notices/media-engine.md',
  'resources/media-engine/win32-x64/FFMPEG-LICENSE.txt', 'resources/media-engine/win32-x64/manifest.json',
  'resources/skills/workbench-storyboard/SKILL.md', 'resources/skills/workbench-h3-prompts/SKILL.md',
  'resources/skills/workbench-editing/SKILL.md', 'resources/skills/workbench-mcp/SKILL.md',
  'resources/fonts/NotoSansCJKsc-Regular.otf', 'resources/fonts/NotoSerifCJKsc-Regular.otf']) {
  if (!(await stat(join(unpacked, file))).isFile()) throw new Error(`Missing packaged resource: ${file}`)
}
const note = mode === 'release'
  ? 'Windows x64 正式发行配置：不包含用户数据、API Key、插件或模型。数据使用固定目录 %APPDATA%\\AI 视频工作台，升级沿用同一 Windows 用户的数据。首次启动为空工作台，已有数据不会因解压新版而自动清空。请先保存并备份，再退出旧版，将完整发行包解压到新目录，不同时启动共享数据目录的新旧版。跨电脑请使用加密迁移，不直接复制加密账号数据库。'
  : mode === 'current'
  ? '本机现有数据调试版：直接使用 %APPDATA%\\AI 视频工作台。保留现有项目、素材位置、账号加密 Key 和 MCP 配置。不会把数据或 Key 复制进 ZIP；仅适用于当前 Windows 用户和电脑。修改会写入原数据。请先关闭开发版，再运行本包，避免单实例冲突和 MCP 5189 端口冲突。MCP 授权仍由软件设置控制，不会扩大授权。'
  : `空白配置版：使用独立数据目录 %APPDATA%\\AI 视频工作台 profiles\\empty-${id}。不读取现有项目、账号或 MCP 配置。每次重新打包生成新的空白配置；同一包再次运行保留本包使用记录。MCP 首次需手动配置授权，固定 5189 端口不能与现有数据版同时使用。`
await writeFile(join(unpacked, '使用说明.txt'), `${note}\r\n\r\n请完整解压后运行 羊驼AI影视.exe，不要只复制 EXE。\r\n公开分发前须落实内置 FFmpeg 及静态依赖的完整对应源码等许可义务，详见 resources/notices/media-engine.md。\r\n`, 'utf8')
const archive = join(root, 'release', `${name}.zip`)
await new Promise((resolveResult, reject) => {
  const child = spawn(path7za, ['a', '-tzip', '-mx=5', archive, 'win-unpacked'], { cwd: output, windowsHide: true, stdio: 'inherit' })
  child.once('error', reject)
  child.once('close', (code) => code === 0 ? resolveResult() : reject(new Error(`ZIP failed: ${code}`)))
})
if (!(await stat(archive)).size) throw new Error('ZIP is empty')
await new Promise((resolveResult, reject) => {
  const child = spawn(path7za, ['t', archive], { windowsHide: true, stdio: 'inherit' })
  child.once('error', reject)
  child.once('close', (code) => code === 0 ? resolveResult() : reject(new Error(`ZIP integrity check failed: ${code}`)))
})
console.log(`ZIP: ${archive}`)
if (mode === 'release') {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(archive)) hash.update(bytes)
  await writeFile(`${archive}.sha256`, `${hash.digest('hex')}  ${name}.zip\n`, 'utf8')
}
console.log(note)
