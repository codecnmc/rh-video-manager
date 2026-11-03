import test from 'node:test'
import assert from 'node:assert/strict'
import { FfmpegMediaInspector } from '../src/main/infrastructure/files/ffmpeg-media-inspector.ts'
import { MediaInspectionError } from '../src/main/application/media-inspector.ts'

const engine = { resolve: async () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }) }
const metadata = Buffer.from(JSON.stringify({ format: { duration: '3' }, streams: [{ codec_type: 'video', width: 1280, height: 736 }] }))

test('首帧、中间帧、近尾帧各自解码，不等待浏览器帧回调', async () => {
  const seeks: string[] = []
  const inspector = new FfmpegMediaInspector(engine, async (binary, args) => {
    if (binary === 'ffprobe') return metadata
    seeks.push(args[args.indexOf('-ss') + 1]!)
    assert.ok(args.indexOf('-ss') > args.indexOf('-i'))
    assert.ok(args.includes('file,pipe'))
    return Buffer.from([0xff, 0xd8, Number(seeks.at(-1)), 0xff, 0xd9])
  })
  const result = await inspector.inspect('managed.mp4', 'video', [0, 1.5, 2.96])
  assert.deepEqual(seeks, ['0', '1.5', '2.96'])
  assert.equal(result.frames.length, 3)
  assert.notEqual(result.frames[0]!.data, result.frames[1]!.data)
})

test('拒绝越界时间和空帧；失败后释放检查锁且不泄漏原始错误', async () => {
  let failure = false
  const inspector = new FfmpegMediaInspector(engine, async (binary) => {
    if (failure) throw new Error('private-path')
    return binary === 'ffprobe' ? metadata : Buffer.alloc(0)
  })
  await assert.rejects(inspector.inspect('managed.mp4', 'video', [3]), /小于视频实际时长/)
  await assert.rejects(inspector.inspect('managed.mp4', 'video', [1]), /未得到有效画面/)
  failure = true
  await assert.rejects(inspector.inspect('managed.mp4', 'video', []), (error: unknown) =>
    error instanceof MediaInspectionError && !error.message.includes('private-path'))
  failure = false
  assert.equal((await inspector.inspect('managed.mp4', 'video', [])).duration, 3)
})

test('校色取帧在缩放之前应用同一导出滤镜，旧调用仍返回原画', async () => {
  const filters: string[] = []
  const inspector = new FfmpegMediaInspector(engine, async (binary, args) => {
    if (binary === 'ffprobe') return metadata
    filters.push(args[args.indexOf('-vf') + 1]!)
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  })
  await inspector.inspect('managed.mp4', 'video', [0])
  await inspector.inspect('managed.mp4', 'video', [0], { brightness: 0, contrast: 1, saturation: 0.96, temperature: -0.01, tint: 0 })
  assert.ok(!filters[0]!.includes('colorchannelmixer'))
  assert.ok(filters[1]!.indexOf('colorchannelmixer') < filters[1]!.indexOf('scale='))
})
