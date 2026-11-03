import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bootstrapPython = process.argv[2]
if (!bootstrapPython) throw new Error('Usage: node scripts/local-tts/prepare-runtime.mjs <bootstrap-python.exe> [output-directory]')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required')
const output = resolve(process.argv[3] ?? join(root, '.cache/local-tts/runtime-win-x64-v1'))
try {
  await access(output)
  throw new Error('Output directory already exists; choose a new directory to avoid overwriting runtime files')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const archive = join(root, '.cache/local-tts/portable-downloads/python-3.13.9-embed-amd64.zip')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
if (hash(await readFile(archive)) !== '91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a') throw new Error('Python archive checksum mismatch')
const sourceModel = join(root, '.cache/local-tts/models/kokoro-int8-multi-lang-v1_0')
for (const [name, expected] of [
  ['model.int8.onnx', '4b86207ef680e394d8343bee22dfc4c512e5c707c6d9578e3f35ab09bffd6b36'],
  ['voices.bin', '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29']
]) {
  if (hash(await readFile(join(sourceModel, name))) !== expected) throw new Error(`Model checksum mismatch: ${name}`)
}
await mkdir(output, { recursive: true })
const pythonDirectory = join(output, 'python')
// 由标准库解包已校验的官方 ZIP，不依赖系统 tar/bzip2 或注册表 Python。
execFileSync(bootstrapPython, ['-m', 'zipfile', '-e', archive, pythonDirectory], { stdio: 'inherit' })
await writeFile(join(pythonDirectory, 'python313._pth'), 'python313.zip\n.\nLib/site-packages\n', 'utf8')
execFileSync(bootstrapPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
  '--only-binary=:all:', '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
  '--target', join(pythonDirectory, 'Lib/site-packages'), '--no-compile', '--ignore-requires-python', '--ignore-installed',
  'sherpa-onnx==1.13.8', 'sherpa-onnx-core==1.13.8', 'numpy==2.2.6'], { stdio: 'inherit' })
await cp(sourceModel, join(output, 'model'), { recursive: true, errorOnExist: true, force: false })
await cp(join(root, 'extensions/kokoro-test/THIRD_PARTY.md'), join(output, 'THIRD_PARTY.md'))
await mkdir(join(output, 'licenses'))
for (const [name, url] of [
  ['espeak-ng-COPYING', 'https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING'],
  ['cppjieba-LICENSE', 'https://raw.githubusercontent.com/yanyiwu/cppjieba/master/LICENSE']
]) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to download license: ${url}`)
  await writeFile(join(output, 'licenses', name), await response.text())
}
execFileSync(join(pythonDirectory, 'python.exe'), ['-I', '-c',
  'import sys, numpy, sherpa_onnx; print(sys.version); print("numpy",numpy.__version__,"sherpa-onnx",sherpa_onnx.__version__)'],
{ cwd: output, stdio: 'inherit' })
// 只有全部装配与导入完成后写就绪标记，半成品不可被插件激活。
await writeFile(join(output, 'runtime.json'), JSON.stringify({ runtimeVersion: 1, platform: 'win32-x64',
  python: '3.13.9', sherpaOnnx: '1.13.8', numpy: '2.2.6', model: 'kokoro-int8-multi-lang-v1_0' }, null, 2))
console.log(`Runtime prepared: ${output}`)
