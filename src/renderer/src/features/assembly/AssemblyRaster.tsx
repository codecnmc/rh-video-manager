import { useEffect, useRef, useState } from 'react'
import type { AssemblyRasterRequest } from '../../../../shared/assembly-surfaces'

export function AssemblyRaster({ request }: { request: AssemblyRasterRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const key = JSON.stringify(request)
  useEffect(() => {
    setFailed(false)
    let worker: Worker
    try { worker = new Worker(new URL('./assembly-raster.worker.ts', import.meta.url), { type: 'module' }) }
    catch { setFailed(true); return }
    worker.onerror = (event) => { event.preventDefault(); setFailed(true) }
    worker.onmessage = (event: MessageEvent<{ width: number; height: number; pixels: ArrayBuffer }>) => {
      const element = canvas.current
      if (!element) return
      element.width = event.data.width; element.height = event.data.height
      const context = element.getContext('2d')
      if (!context) { setFailed(true); return }
      context.putImageData(new ImageData(new Uint8ClampedArray(event.data.pixels), event.data.width, event.data.height), 0, 0)
    }
    // 尺寸或参数变化才重绘，不把滤镜像素计算放进播放帧循环。
    worker.postMessage({ ...request, id: 0 })
    return () => worker.terminate()
  }, [key])
  return <><canvas ref={canvas} aria-hidden="true" className="assembly-raster" />{failed && <span role="alert" className="assembly-raster-error">画面效果预览失败</span>}</>
}
