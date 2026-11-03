export interface FfmpegProgress { seconds: number; speed?: number }

// FFmpeg按行输出key=value；管道数据可能从任意字符处分块，不把诊断或文件路径传给界面。
export class FfmpegProgressParser {
  private buffer = ''
  private seconds = 0
  private speed: number | undefined
  constructor(private readonly onProgress: (progress: FfmpegProgress) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      const separator = line.indexOf('=')
      if (separator < 0) continue
      const key = line.slice(0, separator), value = line.slice(separator + 1)
      if (key === 'out_time_us' || key === 'out_time_ms') {
        const micros = Number(value)
        if (Number.isFinite(micros) && micros >= 0) this.seconds = micros / 1_000_000
      } else if (key === 'speed') {
        const speed = Number(value.replace(/x$/, ''))
        this.speed = Number.isFinite(speed) && speed >= 0 ? speed : undefined
      } else if (key === 'progress') this.onProgress({ seconds: this.seconds, ...(this.speed === undefined ? {} : { speed: this.speed }) })
    }
    if (this.buffer.length > 65536) this.buffer = ''
  }
}
