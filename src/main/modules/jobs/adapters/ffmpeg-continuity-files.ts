import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { link, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { MediaEngine } from '../../../application/media-engine'

const probeSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(),
  duration: z.preprocess((value) => value === 'N/A' ? undefined : value, z.coerce.number().positive().finite().optional()) })),
  format: z.object({ duration: z.coerce.number().positive().finite() }) })

function derivativeId(source: string, seconds: number, kind: string): string {
  const hex = createHash('sha256').update(`continuity-v1:${source}:${seconds}:${kind}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function run(executable: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    let overflow = false
    const timer = setTimeout(() => child.kill(), 120000)
    child.stdout.on('data', (bytes: Buffer) => {
      if (output.length + bytes.length > 1024 * 1024) { overflow = true; child.kill(); return }
      output += bytes.toString('utf8')
    })
    child.once('error', () => { clearTimeout(timer); reject(new Error('本地衔接引擎无法运行')) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (signal.aborted || overflow || code !== 0) reject(new Error('本地衔接处理未完成'))
      else resolve(output)
    })
  })
}

async function publishFile(source: string, target: string): Promise<void> {
  try { await link(source, target) }
  catch (error) {
    // 同源同参数重复恢复复用受管文件，不覆盖已发布素材或归档中的历史引用。
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    if (!(await stat(target)).size) throw new Error('衔接受管文件为空')
  }
}

export class FfmpegContinuityFiles {
  constructor(private readonly directory: string, private readonly engine: Pick<MediaEngine, 'resolve'>) {}

  async prepare(sourceAssetId: string, sourcePath: string, seconds: number, signal: AbortSignal) {
    z.string().uuid().parse(sourceAssetId)
    z.number().int().min(1).max(5).parse(seconds)
    const { ffmpeg, ffprobe } = await this.engine.resolve()
    const inspected = probeSchema.parse(JSON.parse(await run(ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', sourcePath], signal)))
    const video = inspected.streams.find((stream) => stream.codec_type === 'video')
    if (!video) throw new Error('源素材没有视频轨道')
    const end = video.duration ?? inspected.format.duration
    const start = Math.max(0, end - seconds)
    const staging = await mkdtemp(join(this.directory, '.continuity-'))
    try {
      const clip = join(staging, 'tail.mp4')
      const frame = join(staging, 'last.jpg')
      // 精确解码裁切，不按关键帧复制，不缩放、调色或混入上一段对白。
      await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', sourcePath, '-ss', String(start), '-t', String(end - start),
        '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', clip], signal)
      // 逐帧更新最后一秒的单张图片，结束后留下最后一张真实解码帧，避免 seek 到 duration 得到空帧。
      await run(ffmpeg, ['-nostdin', '-v', 'error', '-ss', String(Math.max(0, end - 1)), '-i', sourcePath, '-map', '0:v:0', '-an',
        '-fps_mode', 'passthrough', '-q:v', '2', '-update', '1', '-y', frame], signal)
      const output = probeSchema.parse(JSON.parse(await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', clip], signal)))
      if (!output.streams.some((stream) => stream.codec_type === 'video') || Math.abs(output.format.duration - (end - start)) > 0.5) throw new Error('尾段输出校验失败')
      const videoId = derivativeId(sourceAssetId, seconds, 'video')
      const frameId = derivativeId(sourceAssetId, seconds, 'frame')
      const videoFile = { id: videoId, storedName: `${videoId}.mp4`, size: (await stat(clip)).size, kind: 'video' as const }
      const frameFile = { id: frameId, storedName: `${frameId}.jpg`, size: (await stat(frame)).size, kind: 'image' as const }
      if (!videoFile.size || !frameFile.size || videoFile.size > 200 * 1024 * 1024 || frameFile.size > 10 * 1024 * 1024) throw new Error('衔接素材大小不符合参考上传限制')
      signal.throwIfAborted()
      await publishFile(clip, join(this.directory, videoFile.storedName))
      await publishFile(frame, join(this.directory, frameFile.storedName))
      videoFile.size = (await stat(join(this.directory, videoFile.storedName))).size
      frameFile.size = (await stat(join(this.directory, frameFile.storedName))).size
      return { video: videoFile, frame: frameFile, start, end }
    } finally {
      // staging 来自受管目录内 mkdtemp；仅回收本次创建的临时目录。
      await rm(staging, { recursive: true, force: true })
    }
  }
}
