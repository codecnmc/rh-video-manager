// 读取 RIFF 块而非假设固定 44 字节头，拒绝损坏文件及伪造的音频元数据。
export function inspectPcmWave(audio: Uint8Array): { durationMs: number; sampleRate: number } {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  const text = (offset: number, count: number) => String.fromCharCode(...audio.subarray(offset, offset + count))
  if (audio.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || view.getUint32(4, true) + 8 !== audio.byteLength) throw new Error('插件返回的 WAV 文件不完整')
  let rate = 0; let alignment = 0; let bytes = 0
  for (let offset = 12; offset + 8 <= audio.byteLength;) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > audio.byteLength) throw new Error('插件返回的 WAV 数据越界')
    if (text(offset, 4) === 'fmt ') {
      if (size < 16 || rate) throw new Error('插件返回的 WAV 格式不正确')
      const channels = view.getUint16(start + 2, true)
      rate = view.getUint32(start + 4, true)
      alignment = view.getUint16(start + 12, true)
      if (view.getUint16(start, true) !== 1 || ![1, 2].includes(channels) || view.getUint16(start + 14, true) !== 16 || alignment !== channels * 2 ||
        rate < 8000 || rate > 192000 || view.getUint32(start + 8, true) !== rate * alignment) throw new Error('当前生产音频仅支持 PCM16 单声道或双声道 WAV')
    }
    if (text(offset, 4) === 'data') bytes += size
    offset = start + size + size % 2
  }
  if (!rate || !bytes || bytes % alignment !== 0) throw new Error('插件返回了空音频或不完整采样')
  return { durationMs: bytes / alignment / rate * 1000, sampleRate: rate }
}
