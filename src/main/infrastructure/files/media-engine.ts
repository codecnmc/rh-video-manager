import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { MediaEngine, MediaEnginePaths } from '../../application/media-engine'

export class LocalMediaEngine implements MediaEngine {
  constructor(private readonly bundledDirectory: string,
    private readonly preferences: { read(): string | undefined; write(executable: string): void }) {}

  private async available(paths: MediaEnginePaths): Promise<boolean> {
    return (await Promise.all([paths.ffmpeg, paths.ffprobe].map((path) =>
      stat(path).then((file) => file.isFile() && file.size > 0, () => false)))).every(Boolean)
  }

  async resolve(): Promise<MediaEnginePaths> {
    const bundled = { ffmpeg: join(this.bundledDirectory, 'ffmpeg.exe'), ffprobe: join(this.bundledDirectory, 'ffprobe.exe') }
    if (await this.available(bundled)) return bundled
    // 仅当随包程序缺失时使用用户明确选过的备用引擎，不搜索 PATH 或联网下载。
    const executable = this.preferences.read()
    if (executable && isAbsolute(executable) && /[\\/]ffmpeg\.exe$/i.test(executable)) {
      const fallback = { ffmpeg: executable, ffprobe: join(dirname(executable), 'ffprobe.exe') }
      if (await this.available(fallback)) return fallback
    }
    throw new Error('内置媒体引擎缺失或不完整，请修复安装或手动指定备用 FFmpeg')
  }

  async configure(executable: string): Promise<void> {
    if (!isAbsolute(executable) || !/[\\/]ffmpeg\.exe$/i.test(executable) ||
      !await this.available({ ffmpeg: executable, ffprobe: join(dirname(executable), 'ffprobe.exe') })) {
      throw new Error('请选择完整 FFmpeg 目录中的 ffmpeg.exe，且同目录需有 ffprobe.exe')
    }
    this.preferences.write(executable)
  }
}
