import { useEffect, useRef } from 'react'
import type { Asset } from '@contracts/assets'
import { useAssemblyWaveform } from './use-assembly-waveform'

export function AssemblyWaveform({ asset, sourceIn, duration }: { asset: Asset | undefined; sourceIn: number; duration: number }) {
  const waveform = useAssemblyWaveform(asset)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const draw = () => {
      element.width = Math.min(4096, Math.max(1, Math.round(element.clientWidth * devicePixelRatio)))
      element.height = 48
      const context = element.getContext('2d')
      if (!context || !waveform.data) return
      context.clearRect(0, 0, element.width, element.height)
      context.fillStyle = '#365c50'
      for (let index = 0; index < element.width; index++) {
        const time = sourceIn + index / element.width * duration
        const peak = waveform.data.peaks[Math.floor(time / waveform.data.duration * waveform.data.peaks.length)] ?? 0
        context.fillRect(index, 24 - peak * 24, 1, Math.max(1, peak * 48))
      }
    }
    const observer = new ResizeObserver(draw)
    observer.observe(element); draw()
    return () => observer.disconnect()
  }, [waveform.data, sourceIn, duration])
  return <canvas ref={canvas} className="assembly-waveform" aria-label={waveform.isError || asset && asset.size > 32 * 1024 * 1024 ? '波形暂不可用' : '音频波形'} />
}
