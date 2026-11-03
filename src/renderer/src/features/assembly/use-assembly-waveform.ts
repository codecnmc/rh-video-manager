import { useQuery } from '@tanstack/react-query'
import type { Asset } from '@contracts/assets'
import { mediaSource, probeVideo } from './use-assembly'

export function useAssemblyWaveform(asset: Asset | undefined) {
  return useQuery({ queryKey: ['assembly-waveform', asset?.id, asset?.updatedAt], enabled: !!asset && asset.size <= 32 * 1024 * 1024,
    staleTime: Infinity, gcTime: 5 * 60 * 1000, retry: false, queryFn: async ({ signal }) => {
      if (!asset) throw new Error('素材不可用')
      const duration = await probeVideo(asset.id, asset.kind === 'audio' ? 'audio' : 'video')
      if (duration > 600) throw new Error('长音频暂不生成波形')
      const response = await fetch(mediaSource(asset.id), { signal })
      if (!response.ok) throw new Error('波形读取失败')
      const bytes = await response.arrayBuffer()
      signal.throwIfAborted()
      const context = new AudioContext()
      try {
        const audio = await context.decodeAudioData(bytes)
        signal.throwIfAborted()
        const count = 2000
        const peaks = new Array<number>(count).fill(0)
        for (let channel = 0; channel < audio.numberOfChannels; channel++) {
          const samples = audio.getChannelData(channel)
          for (let index = 0; index < count; index++) {
            let peak = peaks[index]!
            const end = Math.min(samples.length, Math.floor((index + 1) * samples.length / count))
            for (let sample = Math.floor(index * samples.length / count); sample < end; sample++) peak = Math.max(peak, Math.abs(samples[sample]!))
            peaks[index] = peak
          }
        }
        return { peaks, duration: audio.duration }
      } finally { await context.close() }
    } })
}
