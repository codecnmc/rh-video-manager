import { dialog, type BrowserWindow } from 'electron'
import type { MediaEngine, MediaEnginePaths } from '../application/media-engine'

export async function selectMediaEngine(engine: MediaEngine, window: BrowserWindow, signal?: AbortSignal): Promise<MediaEnginePaths | null> {
  signal?.throwIfAborted()
  try { return await engine.resolve() } catch { /* 内置和已选备用均不可用时，才提示用户。 */ }
  const answer = await dialog.showMessageBox(window, { type: 'warning', title: '媒体引擎不可用',
    message: '内置 FFmpeg / FFprobe 缺失，请修复安装，或指定可信的备用引擎。',
    detail: '不会下载程序或上传素材。备用目录必须同时包含 ffmpeg.exe 和 ffprobe.exe。', buttons: ['选择备用 FFmpeg', '取消'], cancelId: 1 })
  signal?.throwIfAborted()
  if (answer.response !== 0 || window.isDestroyed()) return null
  const selected = await dialog.showOpenDialog(window, { title: '选择备用 ffmpeg.exe（同目录需有 ffprobe.exe）', properties: ['openFile'], filters: [{ name: 'FFmpeg', extensions: ['exe'] }] })
  signal?.throwIfAborted()
  if (selected.canceled || !selected.filePaths[0] || window.isDestroyed()) return null
  await engine.configure(selected.filePaths[0])
  return engine.resolve()
}
