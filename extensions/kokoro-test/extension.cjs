const { spawn } = require('node:child_process')
const { readFile, mkdir, writeFile, access } = require('node:fs/promises')
const { createHash, randomUUID } = require('node:crypto')
const { resolve, join, isAbsolute } = require('node:path')

const voices = ['zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang']
const children = new Set()
let running = false

async function validateRuntime(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('An absolute runtime directory is required')
  const root = resolve(directory)
  const metadata = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))
  if (metadata.runtimeVersion !== 1 || metadata.platform !== 'win32-x64') throw new Error('Unsupported runtime')
  await access(join(root, 'python', 'python.exe'))
  for (const [name, expected] of [
    ['model.int8.onnx', '4b86207ef680e394d8343bee22dfc4c512e5c707c6d9578e3f35ab09bffd6b36'],
    ['voices.bin', '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29']
  ]) {
    const bytes = await readFile(join(root, 'model', name))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Model checksum mismatch')
  }
  return root
}

function worker(runtime, request, signal) {
  signal.throwIfAborted()
  return new Promise((resolveResult, reject) => {
    // 不使用 shell，不继承 Python 路径，不从 PATH 查找解释器。
    const child = spawn(join(runtime, 'python', 'python.exe'), ['-I', join(__dirname, 'synthesize.py')], {
      cwd: runtime, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
    })
    children.add(child)
    const chunks = []
    let size = 0
    let failed = false
    const stop = () => { failed = true; child.kill() }
    const timer = setTimeout(stop, 110000)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > 20 * 1024 * 1024) stop()
      else chunks.push(chunk)
    })
    child.stdin.on('error', stop)
    child.once('error', () => { failed = true })
    child.once('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      children.delete(child)
      child.stdin.destroy()
      if (failed || code !== 0 || signal.aborted) reject(new Error('Local speech worker failed or was cancelled'))
      else resolveResult(Buffer.concat(chunks))
    })
    // 保持管道打开，宿主退出时 Python 看门线程收到 EOF 后终止推理。
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}

function inspectWav(audio) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
      audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 ||
      audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 24000 || audio.readUInt16LE(34) !== 16 ||
      audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44) throw new Error('Invalid PCM WAV')
  let peak = 0
  for (let offset = 44; offset + 1 < audio.length; offset += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(offset)))
  if (!peak) throw new Error('Empty or silent WAV')
  return { durationMs: (audio.length - 44) / 48, sampleRate: 24000 }
}

exports.activate = async function (context) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This test extension requires Windows x64')
  const runtime = await validateRuntime(context.configuration['runtime-directory'])
  const provider = {
    async listVoices(signal) {
      signal.throwIfAborted()
      return voices.map((name, index) => ({ id: String(index + 45), name, language: 'zh-CN', source: 'preset' }))
    },
    async synthesize(request, signal) {
      if (running) throw new Error('Speech worker is busy')
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 120 ||
          !/^(4[5-9]|5[0-2])$/.test(request.voiceId) || !['zh', 'zh-CN'].includes(request.language) ||
          request.delivery?.description || request.targetDurationMs !== undefined) throw new Error('Unsupported test request')
      const speed = request.delivery?.speed ?? 1
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Invalid speech speed')
      running = true
      try {
        const audio = await worker(runtime, { text: request.text, voice: Number(request.voiceId), speed }, signal)
        return { audio, format: 'wav', ...inspectWav(audio) }
      } finally { running = false }
    }
  }
  context.subscriptions.push(context.registerSpeechProvider('workbench.kokoro-test.cpu', provider))
  context.subscriptions.push(context.registerCommand('workbench.kokoro-test.generate', async (signal) => {
    const text = context.configuration['test-text'] || '你好，这是插件中的本地语音合成测试。新的故事，现在开始。'
    const result = await provider.synthesize({ text, voiceId: String(context.configuration['voice-id'] ?? 45), language: 'zh-CN',
      delivery: { description: '', speed: context.configuration.speed ?? 1 } }, signal)
    signal.throwIfAborted()
    await mkdir(context.storagePath, { recursive: true })
    // 每次写入新文件，停用、卸载和重装不覆盖或清理此前结果。
    const output = join(context.storagePath, `kokoro-${randomUUID()}.wav`)
    await writeFile(output, result.audio, { flag: 'wx' })
  }))
  context.subscriptions.push(context.registerCommand('workbench.kokoro-test.open-output', async (signal) => {
    signal.throwIfAborted()
    await context.openStorageDirectory()
  }))
  context.subscriptions.push({ dispose() { for (const child of children) child.kill() } })
}

exports.deactivate = function () { for (const child of children) child.kill() }
