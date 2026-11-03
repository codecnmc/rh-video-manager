import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { MediaEngine } from '../../application/media-engine'
import { MediaInspectionError, type MediaInspector, type MediaInspection } from '../../application/media-inspector'
import { clipColorSchema, type ClipColor } from '../../../shared/contracts/assembly'
import { clipColorFfmpegFilter } from '../../../shared/clip-color'

const execute = promisify(execFile)
const probeSchema = z.object({
  format: z.object({ duration: z.coerce.number().positive().finite() }),
  streams: z.array(z.object({ codec_type: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }))
})
const demuxers = 'mov,matroska,avi,mpegvideo,mpeg,mp3,wav,flac,ogg,aac,asf'

export type InspectionRunner = (binary: string, args: string[]) => Promise<Buffer>

async function run(binary: string, args: string[]): Promise<Buffer> {
  try {
    const { stdout } = await execute(binary, args, { encoding: 'buffer', windowsHide: true, timeout: 20000, maxBuffer: 2_000_000 })
    return stdout
  } catch (error) {
    const timedOut = error instanceof Error && 'killed' in error && error.killed === true
    throw new MediaInspectionError(timedOut ? '媒体取帧超时，请减少取帧点后重试' : '媒体解码失败，请检查素材格式及内置媒体引擎')
  }
}

export class FfmpegMediaInspector implements MediaInspector {
  private busy = false

  constructor(private readonly engine: Pick<MediaEngine, 'resolve'>, private readonly runner: InspectionRunner = run) {}

  async inspect(path: string, kind: 'video' | 'audio', times: number[], color?: ClipColor): Promise<MediaInspection> {
    if (this.busy) throw new MediaInspectionError('媒体检查忙，请稍后重试')
    if (!z.array(z.number().finite().nonnegative()).max(6).safeParse(times).success || (kind === 'audio' && times.length)) {
      throw new MediaInspectionError('取帧参数无效，仅视频支持最多 6 个非负时间点')
    }
    this.busy = true
    try {
      const colorFilter = clipColorFfmpegFilter(color === undefined ? undefined : clipColorSchema.parse(color))
      const { ffmpeg, ffprobe } = await this.engine.resolve()
      const input = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', demuxers]
      const raw = await this.runner(ffprobe, ['-v', 'error', ...input, '-show_format', '-show_streams', '-of', 'json', path])
      const metadata = probeSchema.parse(JSON.parse(raw.toString('utf8')) as unknown)
      const video = metadata.streams.find((stream) => stream.codec_type === 'video')
      if (kind === 'video' && (!video?.width || !video.height)) throw new MediaInspectionError('素材没有可用的视频轨道')
      if (times.some((time) => time >= metadata.format.duration)) throw new MediaInspectionError('取帧时间必须小于视频实际时长')
      const frames: MediaInspection['frames'] = []
      for (const time of times) {
        // 精确解码到指定时间；直接收集 JPEG 二进制，不依赖隐藏窗口的播放和合成回调。
        const bytes = await this.runner(ffmpeg, ['-nostdin', '-v', 'error', ...input, '-i', path, '-ss', String(time),
          '-map', '0:v:0', '-an', '-frames:v', '1', '-vf', [colorFilter, "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease"].filter(Boolean).join(','),
          '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1'])
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > 600000) {
          throw new MediaInspectionError('指定时间未得到有效画面或画面超过大小限制')
        }
        frames.push({ time, data: bytes.toString('base64') })
      }
      return { duration: metadata.format.duration, width: video?.width ?? 0, height: video?.height ?? 0, frames }
    } catch (error) {
      if (error instanceof MediaInspectionError) throw error
      throw new MediaInspectionError('媒体检查失败，请检查素材及内置媒体引擎')
    } finally {
      this.busy = false
    }
  }
}
