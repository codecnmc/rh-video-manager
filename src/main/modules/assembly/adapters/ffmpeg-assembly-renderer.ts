import { spawn } from 'node:child_process'
import { access, copyFile, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import type { AssemblyExportPlan, AssemblyRenderer } from '../ports/assembly-export'
import { clipColorFfmpegFilter } from '../../../../shared/clip-color'
import { defaultCaptionStyle, soundGain, soundStart, timelineClips, totalDuration } from '../../../../shared/assembly-timing'
import { canvasFfmpegFilter, resolveAssemblyCanvas, titleFonts } from '../../../../shared/assembly-visual'
import { prepareGeneratedVisual, subtitleFilter } from './ffmpeg-generated-visual'
import { assemblyTransitions, isOverlappingTransition } from '../../../../shared/assembly-transitions'
import { writeAssemblyRaster } from './assembly-raster-png'
import { assemblyExportOptionsSchema, defaultAssemblyExportOptions, type AssemblyRenderProgress } from '../../../../shared/contracts/assembly-export'
import { FfmpegProgressParser, type FfmpegProgress } from './ffmpeg-progress'
import { exportCanvas } from './assembly-export-options'

const probeSchema = z.object({
  format: z.object({ duration: z.string() }),
  streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional(), avg_frame_rate: z.string().optional() }))
})
const demuxers = 'mov,matroska,avi,mpegvideo,mpeg,mp3,wav,flac,ogg,aac,asf'

// 不经 shell 拼命令；不允许素材通过播放列表访问网络或其他本地文件。
function run(binary: string, args: string[], signal: AbortSignal,
  failure = '媒体合成失败，请检查素材格式、FFmpeg 编码器和磁盘空间', onProgress?: (progress: FfmpegProgress) => void): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, onProgress ? ['-progress', 'pipe:1', '-stats_period', '0.5', '-nostats', ...args] : args,
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const parser = onProgress ? new FfmpegProgressParser(onProgress) : undefined
    let output = ''
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill() }, 30 * 60 * 1000)
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stdout.on('data', (chunk: Buffer) => {
      if (parser) parser.push(chunk.toString('utf8'))
      else if (output.length < 2_000_000) output += chunk.toString('utf8')
    })
    // 原始诊断可能含本地路径，不透传给 renderer。
    child.stderr.resume()
    child.once('error', () => { cleanup(); reject(new Error('无法启动 FFmpeg，请重新选择含 ffprobe 的完整工具目录')) })
    child.once('close', (code) => {
      cleanup()
      if (signal.aborted) reject(new Error('导出已取消'))
      else if (timedOut) reject(new Error('导出超时，请缩短时间轴或降低源文件大小'))
      else if (code !== 0) reject(new Error(failure))
      else resolveResult(output)
    })
    function cleanup() { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
  })
}

export class FfmpegAssemblyRenderer implements AssemblyRenderer {
  constructor(private readonly ffmpeg: string, private readonly ffprobe: string, private readonly fontDirectory: string) {}

  async render(plan: AssemblyExportPlan, target: string, signal: AbortSignal, onProgress?: (progress: AssemblyRenderProgress) => void): Promise<void> {
    const options = assemblyExportOptionsSchema.parse(plan.options ?? defaultAssemblyExportOptions)
    const encodeVideo = ['-c:v', 'libx264', '-preset', options.preset, '-crf', String(options.crf), '-pix_fmt', 'yuv420p']
    const encodeAudio = ['-c:a', 'aac', '-b:a', options.audioBitrate, '-ar', '48000', '-ac', '2']
    let percent = 0
    const report = (progress: AssemblyRenderProgress) => {
      percent = Math.max(percent, Math.min(99, progress.percent))
      onProgress?.({ ...progress, percent })
    }
    const progressFor = (stage: AssemblyRenderProgress['stage'], detail: string, base: number, span: number, duration: number,
      extra: Pick<AssemblyRenderProgress, 'clipIndex' | 'clipCount'> = {}) => (update: FfmpegProgress) => {
      const processedSeconds = Math.min(duration, update.seconds)
      const fraction = Math.max(0, Math.min(1, processedSeconds / Math.max(duration, 0.001)))
      report({ stage, detail, percent: base + span * fraction, stagePercent: fraction * 100,
        processedSeconds, durationSeconds: duration, ...(update.speed === undefined ? {} : { speed: update.speed }), ...extra })
    }
    const paths = [...plan.files.values()]
    if (paths.some((path) => resolve(path).toLowerCase() === resolve(target).toLowerCase())) throw new Error('导出不能覆盖原素材')
    const directory = await mkdtemp(join(tmpdir(), 'workbench-assembly-'))
    let staged: string | undefined
    try {
      const metadata = new Map<string, z.infer<typeof probeSchema>>()
      for (const [id, path] of plan.files) {
        signal.throwIfAborted()
        report({ stage: 'probing', detail: `检查素材 ${metadata.size + 1} / ${plan.files.size}`, percent: 5 * metadata.size / Math.max(1, plan.files.size),
          stagePercent: 100 * metadata.size / Math.max(1, plan.files.size) })
        const raw = await run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', demuxers,
          '-show_format', '-show_streams', '-of', 'json', path], signal)
        const parsed = probeSchema.parse(JSON.parse(raw) as unknown)
        if (!Number.isFinite(Number(parsed.format.duration)) || Number(parsed.format.duration) <= 0) throw new Error('素材实际时长无效，不能导出')
        metadata.set(id, parsed)
      }
      const firstVideo = plan.version.clips.find((clip) => clip.assetId)
      const first = firstVideo?.assetId ? metadata.get(firstVideo.assetId)?.streams.find((stream) => stream.codec_type === 'video') : undefined
      if (firstVideo && (!first?.width || !first.height || first.width > 4096 || first.height > 4096)) throw new Error('首段视频尺寸无效或超过 4096 像素')
      const canvas = exportCanvas(resolveAssemblyCanvas(plan.version, first?.width && first.height ? { width: first.width, height: first.height } : undefined), options.resolution)
      const { width, height } = canvas
      const fps = options.frameRate === 'project' ? plan.version.frameRate ?? 30 : Number(options.frameRate)
      const cursor = totalDuration(plan.version)
      const entries = timelineClips(plan.version)
      const maskFiles = new Map<string, string>()
      const renderDuration = plan.version.clips.reduce((sum, clip) => sum + clip.outPoint - clip.inPoint + (clip.gapBefore ?? 0), 0)
      let renderedDuration = 0
      for (const [index, clip] of plan.version.clips.entries()) {
        const duration = clip.outPoint - clip.inPoint
        const gap = clip.gapBefore ?? 0
        const progress = progressFor('rendering', `${clip.visual ? '生成文字卡' : '编码视频'}：${clip.title}`, 5 + 70 * renderedDuration / renderDuration,
          70 * (duration + gap) / renderDuration, duration + gap, { clipIndex: index + 1, clipCount: plan.version.clips.length })
        progress({ seconds: 0 })
        const info = clip.assetId ? metadata.get(clip.assetId) : undefined
        if (!clip.visual && (!info?.streams.some((stream) => stream.codec_type === 'video') || clip.outPoint > Number(info.format.duration) + 0.05)) {
          throw new Error('视频实际时长或格式与工程不符，请重新添加素材并确认裁切范围')
        }
        if (!clip.visual) {
          const [numerator, denominator] = (info!.streams.find((stream) => stream.codec_type === 'video')?.avg_frame_rate ?? '30/1').split('/').map(Number)
          const rate = numerator! / denominator!
          if (!Number.isFinite(rate) || rate <= 0) throw new Error('素材帧率无法确认，请检查源视频')
        }
        const generated = clip.visual ? await prepareGeneratedVisual(clip.visual, canvas, fps, directory, index, this.fontDirectory) : undefined
        const original = clip.originalAudio && !plan.version.tracks?.some((track) => track.solo) && !!info?.streams.some((stream) => stream.codec_type === 'audio')
        const args = ['-v', 'error', '-nostdin', '-y', ...(generated ? generated.input : ['-protocol_whitelist', 'file,pipe', '-format_whitelist', demuxers,
          '-ss', String(clip.inPoint), '-i', plan.files.get(clip.assetId!)!])]
        if (!original) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
        const mask = clip.frameMask === undefined ? plan.version.frameMask : clip.frameMask
        let maskIndex: number | undefined
        if (mask) {
          const key = JSON.stringify(mask)
          let path = maskFiles.get(key)
          if (!path) {
            path = join(directory, `mask-${index}.png`)
            await writeAssemblyRaster(path, { kind: 'mask', width, height, mask })
            maskFiles.set(key, path)
          }
          maskIndex = original ? 1 : 2
          args.push('-loop', '1', '-framerate', String(fps), '-i', path)
        }
        const colorFilter = clipColorFfmpegFilter(clip.color)
        const incoming = clip.transition && !isOverlappingTransition(clip.transition.kind) ? clip.transition.duration / 2 : 0
        const next = plan.version.clips[index + 1]?.transition
        const outgoing = next && !isOverlappingTransition(next.kind) ? next.duration / 2 : 0
        const fadeIn = Math.max(clip.fadeIn ?? 0, incoming)
        const fadeOut = Math.max(clip.fadeOut ?? 0, outgoing)
        const transform = clip.transform
        const crop = transform && transform.scale > 1 ? `scale=${Math.ceil(width * transform.scale / 2) * 2}:${Math.ceil(height * transform.scale / 2) * 2},crop=${width}:${height}:(iw-ow)*${(transform.x + 1) / 2}:(ih-oh)*${(transform.y + 1) / 2}` : ''
        const baseFilters = [`trim=duration=${duration},setpts=PTS-STARTPTS`, generated?.filter, colorFilter, `${canvasFfmpegFilter(canvas)},fps=${fps}`, crop].filter(Boolean).join(',')
        const finishing = [fadeIn ? `fade=t=in:st=0:d=${fadeIn}:color=${incoming && clip.transition?.kind === 'white' ? 'white' : 'black'}` : '',
          fadeOut ? `fade=t=out:st=${duration - fadeOut}:d=${fadeOut}:color=${outgoing && next?.kind === 'white' ? 'white' : 'black'}` : '',
          gap ? `tpad=start_mode=add:start_duration=${gap}:color=black` : ''].filter(Boolean).join(',')
        if (maskIndex === undefined) args.push('-vf', [baseFilters, finishing].filter(Boolean).join(','), '-map', '0:v:0')
        else args.push('-filter_complex_threads', '1', '-filter_complex', `[0:v]${baseFilters}[base];[base][${maskIndex}:v]overlay=shortest=1:format=auto${finishing ? `,${finishing}` : ''}[masked]`, '-map', '[masked]')
        args.push('-map', original ? '0:a:0' : '1:a:0', '-t', String(duration + gap),
          '-af', `apad,atrim=duration=${duration},asetpts=PTS-STARTPTS${gap ? `,adelay=${Math.round(gap * 48000)}S:all=1` : ''}`, ...encodeVideo,
          ...encodeAudio, join(directory, `${index}.mp4`))
        await run(this.ffmpeg, args, signal, undefined, progress)
        progress({ seconds: duration + gap })
        renderedDuration += duration + gap
      }
      // 列表只含本次临时目录内的数字文件名，不插入用户文本或路径。
      await writeFile(join(directory, 'clips.txt'), plan.version.clips.map((_clip, index) => `file '${index}.mp4'`).join('\n'), 'utf8')
      const concat = join(directory, 'joined.mp4')
      if (plan.version.clips.some((clip) => isOverlappingTransition(clip.transition?.kind))) {
        const joinWork = entries.slice(1).reduce((sum, entry) => sum + entry.end, 0)
        let joinedWork = 0
        let joined = join(directory, '0.mp4')
        for (let index = 1; index < plan.version.clips.length; index++) {
          const clip = plan.version.clips[index]!
          const output = join(directory, `join-${index}.mp4`)
          const transition = clip.transition
          const previousDuration = entries[index - 1]!.end
          const nextDuration = clip.outPoint - clip.inPoint + (clip.gapBefore ?? 0)
          const progress = progressFor('joining', `合成接点 ${index} / ${plan.version.clips.length - 1}：${clip.title}`,
            75 + 14 * joinedWork / joinWork, 14 * entries[index]!.end / joinWork, entries[index]!.end)
          progress({ seconds: 0 })
          // 中间 AAC 文件可能有编码填充，接点前按工程时长重新裁齐，避免逐段积累漂移。
          const inputs = `[0:v]trim=duration=${previousDuration},settb=AVTB,setpts=PTS-STARTPTS[v0];[1:v]trim=duration=${nextDuration},settb=AVTB,setpts=PTS-STARTPTS[v1];[0:a]apad,atrim=duration=${previousDuration},asetpts=PTS-STARTPTS[a0];[1:a]apad,atrim=duration=${nextDuration},asetpts=PTS-STARTPTS[a1];`
          const filters = inputs + (transition && isOverlappingTransition(transition.kind)
            ? `[v0][v1]xfade=transition=custom:expr='${assemblyTransitions[transition.kind].expression}':duration=${transition.duration}:offset=${entries[index]!.start}[v];[a0][a1]acrossfade=d=${transition.duration}:c1=tri:c2=tri[a]`
            : '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]')
          await writeFile(join(directory, 'join.txt'), filters, 'utf8')
          await run(this.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', joined, '-i', join(directory, `${index}.mp4`),
            '-filter_complex_threads', '1', '-filter_complex_script', join(directory, 'join.txt'), '-map', '[v]', '-map', '[a]',
            ...encodeVideo, ...encodeAudio, output], signal, undefined, progress)
          progress({ seconds: entries[index]!.end })
          joinedWork += entries[index]!.end
          await rm(joined)
          joined = output
        }
        await copyFile(joined, concat)
      } else {
        const progress = progressFor('joining', '拼接已编码片段', 75, 14, cursor)
        progress({ seconds: 0 })
        await run(this.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', join(directory, 'clips.txt'), '-c', 'copy', concat], signal, undefined, progress)
        progress({ seconds: cursor })
      }
      const sounds = plan.version.sounds.flatMap((sound) => {
        const start = soundStart(plan.version, sound)
        if (sound.state === 'bound' && sound.assetId) {
          const info = metadata.get(sound.assetId)!
          if (!info.streams.some((stream) => stream.codec_type === 'audio') || (sound.sourceIn ?? 0) + sound.duration > Number(info.format.duration) + 0.05) throw new Error('音频源区间超出实际素材或素材没有音轨，请调整入点与时长')
        }
        return sound.state === 'bound' && sound.assetId && start < cursor && soundGain(plan.version, sound) > 0
          ? [{ sound, start, duration: Math.min(sound.duration, cursor - start) }] : []
      })
      const output = join(directory, 'output.mp4')
      const mixProgress = progressFor('mixing', '混合原声和已绑定音轨', 89, 5, cursor)
      mixProgress({ seconds: 0 })
      if (sounds.length) {
        const args = ['-v', 'error', '-nostdin', '-y', '-i', concat]
        const filters = ['[0:a]asetpts=PTS-STARTPTS[original]']
        for (const [index, { sound, start, duration }] of sounds.entries()) {
          args.push('-protocol_whitelist', 'file,pipe', '-format_whitelist', demuxers, '-i', plan.files.get(sound.assetId!)!)
          const fadeIn = sound.fadeIn ? `,afade=t=in:st=0:d=${sound.fadeIn}` : ''
          const fadeOut = sound.fadeOut ? `,afade=t=out:st=${sound.duration - sound.fadeOut}:d=${sound.fadeOut}` : ''
          filters.push(`[${index + 1}:a]aresample=48000,atrim=start=${sound.sourceIn ?? 0}:duration=${duration},asetpts=PTS-STARTPTS,volume=${soundGain(plan.version, sound)}${fadeIn}${fadeOut},adelay=${Math.round(start * 48000)}S:all=1[s${index}]`)
        }
        filters.push(`[original]${sounds.map((_sound, index) => `[s${index}]`).join('')}amix=inputs=${sounds.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:level=false:latency=true[mix]`)
        await writeFile(join(directory, 'mix.txt'), filters.join(';'), 'utf8')
        args.push('-filter_complex_script', join(directory, 'mix.txt'), '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', ...encodeAudio,
          '-t', String(cursor), '-movflags', '+faststart', output)
        await run(this.ffmpeg, args, signal, undefined, mixProgress)
      } else {
        await run(this.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', concat, '-c', 'copy', '-t', String(cursor), '-movflags', '+faststart', output], signal, undefined, mixProgress)
      }
      mixProgress({ seconds: cursor })
      let finalOutput = output
      const burnCaptions = options.captions === 'project' ? plan.version.burnCaptions ?? true : options.captions === 'on'
      if (burnCaptions && plan.version.captions?.length) {
        const progress = progressFor('captions', '烧录普通字幕', 94, 5, cursor)
        progress({ seconds: 0 })
        const style = plan.version.captionStyle ?? defaultCaptionStyle
        const font = style.font ? titleFonts[style.font] : undefined
        if (font) {
          try { await access(join(this.fontDirectory, font.file)) }
          catch { throw new Error(`字幕所需本地字体不可用：${font.label}`) }
        }
        const color = `&H00${style.color.slice(5, 7)}${style.color.slice(3, 5)}${style.color.slice(1, 3)}`
        const time = (seconds: number) => {
          const centiseconds = Math.round(seconds * 100)
          return `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
        }
        // 字幕文本只进入 ASS 数据文件，不插入命令或过滤器表达式。
        const events = plan.version.captions.filter((caption) => caption.start < cursor).map((caption) => {
          const text = caption.text.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}').replace(/\r\n?|\n/g, '\\N')
          return `Dialogue: 0,${time(caption.start)},${time(Math.min(caption.end, cursor))},Default,,0,0,0,,${text}`
        })
        const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font?.family ?? 'Microsoft YaHei'},${height * style.size / 100},${color},${color},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${height * style.outline / 100},0,${style.alignment === 'center' ? 5 : 2},${Math.round(width * 0.05)},${Math.round(width * 0.05)},${style.alignment === 'center' ? 0 : Math.round(height * style.bottom / 100)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`
        const subtitlePath = join(directory, 'captions.ass')
        await writeFile(subtitlePath, ass, 'utf8')
        finalOutput = join(directory, 'captioned.mp4')
        await run(this.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', output, '-vf', subtitleFilter(subtitlePath, this.fontDirectory),
          ...encodeVideo, '-c:a', 'copy', '-t', String(cursor), '-movflags', '+faststart', finalOutput], signal,
        '字幕烧录失败，请检查 FFmpeg 是否包含 libass/subtitles 支持，以及本地字体是否可用', progress)
        progress({ seconds: cursor })
      }
      report({ stage: 'finalizing', detail: '检查并写入成片文件', percent: 99, stagePercent: null })
      if ((await stat(finalOutput)).size === 0) throw new Error('导出结果为空，未保存成片')
      signal.throwIfAborted()
      // 先在目标磁盘写完整临时文件，再替换；失败或取消不破坏已有成片。
      const stagingDirectory = await mkdtemp(join(dirname(target), '.workbench-export-'))
      staged = stagingDirectory
      const ready = join(stagingDirectory, 'output.mp4')
      await copyFile(finalOutput, ready, constants.COPYFILE_EXCL)
      signal.throwIfAborted()
      await rename(ready, target)
    } finally {
      if (staged) await rm(staged, { recursive: true, force: true })
      await rm(directory, { recursive: true, force: true })
    }
  }
}
