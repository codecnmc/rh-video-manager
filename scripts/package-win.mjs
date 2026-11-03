import { build, Platform, Arch } from 'electron-builder'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
if (!['empty', 'current'].includes(mode)) throw new Error('Usage: node scripts/package-win.mjs empty|current')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { getPath7za } = libraryRequire('./toolsets/7zip')
const path7za = await getPath7za()
const id = randomUUID()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const name = `ai-video-workbench-${mode === 'current' ? 'current-data' : 'empty'}-${stamp}`
const output = join(root, 'release', name)
await mkdir(output, { recursive: true })
await build({
  targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
  config: {
    directories: { output },
    extraMetadata: { workbenchDataProfile: mode === 'current' ? 'current' : `empty-${id}` }
  }
})
const unpacked = join(output, 'win-unpacked')
const { extractFile } = libraryRequire('@electron/asar')
const metadata = JSON.parse(extractFile(join(unpacked, 'resources/app.asar'), 'package.json').toString('utf8'))
if (metadata.workbenchDataProfile !== (mode === 'current' ? 'current' : `empty-${id}`)) throw new Error('Packaged data profile mismatch')
for (const file of ['羊驼AI影视.exe', 'resources/app.asar.unpacked/out/main/extension-host.js',
  'resources/alpaca.ico', 'resources/alpaca.png',
  'resources/media-engine/win32-x64/ffmpeg.exe', 'resources/media-engine/win32-x64/ffprobe.exe',
  'resources/fonts/NotoSansCJKsc-Regular.otf', 'resources/fonts/NotoSerifCJKsc-Regular.otf']) {
  if (!(await stat(join(unpacked, file))).isFile()) throw new Error(`Missing packaged resource: ${file}`)
}
const note = mode === 'current'
  ? '本机现有数据调试版：直接使用 %APPDATA%\\AI 视频工作台。保留现有项目、素材位置、账号加密 Key 和 MCP 配置。不会把数据或 Key 复制进 ZIP；仅适用于当前 Windows 用户和电脑。修改会写入原数据。请先关闭开发版，再运行本包，避免单实例冲突和 MCP 5189 端口冲突。MCP 授权仍由软件设置控制，不会扩大授权。'
  : `空白配置版：使用独立数据目录 %APPDATA%\\AI 视频工作台 profiles\\empty-${id}。不读取现有项目、账号或 MCP 配置。每次重新打包生成新的空白配置；同一包再次运行保留本包使用记录。MCP 首次需手动配置授权，固定 5189 端口不能与现有数据版同时使用。`
await writeFile(join(unpacked, '使用说明.txt'), `${note}\r\n\r\n请完整解压后运行 羊驼AI影视.exe，不要只复制 EXE。\r\n本包用于本机测试；对外发布前仍须落实内置 FFmpeg 的完整对应源码等许可义务。\r\n`, 'utf8')
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
console.log(note)
