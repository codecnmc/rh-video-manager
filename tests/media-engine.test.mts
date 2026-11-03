import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMediaEngine } from '../src/main/infrastructure/files/media-engine.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-media-engine-'))
  const bundled = join(directory, 'resources/media-engine/win32-x64')
  const fallback = join(directory, 'fallback')
  await mkdir(bundled, { recursive: true })
  await mkdir(fallback)
  let selected: string | undefined
  const engine = new LocalMediaEngine(bundled, { read: () => selected, write: (path) => { selected = path } })
  const pair = async (path: string) => {
    await writeFile(join(path, 'ffmpeg.exe'), 'fixture-executable')
    await writeFile(join(path, 'ffprobe.exe'), 'fixture-executable')
    return { ffmpeg: join(path, 'ffmpeg.exe'), ffprobe: join(path, 'ffprobe.exe') }
  }
  return { directory, bundled, fallback, engine, pair, select: (path: string) => { selected = path } }
}

test('默认自动解析同目录内置引擎，不要求手动配置，也不使用旧备用配置', async () => {
  const app = await fixture()
  try {
    const bundled = await app.pair(app.bundled)
    const fallback = await app.pair(app.fallback)
    app.select(fallback.ffmpeg)
    assert.deepEqual(await app.engine.resolve(), bundled)
  } finally { await rm(app.directory, { recursive: true, force: true }) }
})

test('内置引擎不完整时仅使用用户明确配置的完整备用引擎', async () => {
  const app = await fixture()
  try {
    await writeFile(join(app.bundled, 'ffmpeg.exe'), 'incomplete-pair')
    const fallback = await app.pair(app.fallback)
    await app.engine.configure(fallback.ffmpeg)
    assert.deepEqual(await app.engine.resolve(), fallback)
    await writeFile(fallback.ffprobe, '')
    await assert.rejects(app.engine.resolve(), /内置媒体引擎缺失/)
  } finally { await rm(app.directory, { recursive: true, force: true }) }
})

test('不搜索 PATH，不接受相对路径、错误程序名或缺少 FFprobe 的备用程序', async () => {
  const app = await fixture()
  try {
    await assert.rejects(app.engine.resolve(), /内置媒体引擎缺失/)
    await assert.rejects(app.engine.configure('ffmpeg.exe'), /请选择完整/)
    await writeFile(join(app.fallback, 'ffmpeg.exe'), 'incomplete-pair')
    await assert.rejects(app.engine.configure(join(app.fallback, 'ffmpeg.exe')), /请选择完整/)
    await app.pair(app.fallback)
    await writeFile(join(app.fallback, 'other.exe'), 'fixture-executable')
    await assert.rejects(app.engine.configure(join(app.fallback, 'other.exe')), /请选择完整/)
  } finally { await rm(app.directory, { recursive: true, force: true }) }
})
