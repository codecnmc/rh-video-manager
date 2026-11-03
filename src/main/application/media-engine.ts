export interface MediaEnginePaths {
  ffmpeg: string
  ffprobe: string
}

// 路径只在主进程使用，不进入 IPC DTO、素材或 MCP 返回值。
export interface MediaEngine {
  resolve(): Promise<MediaEnginePaths>
  configure(executable: string): Promise<void>
}
