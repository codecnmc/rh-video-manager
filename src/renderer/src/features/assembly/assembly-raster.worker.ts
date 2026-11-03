import { assemblyRaster, type AssemblyRasterRequest } from '../../../../shared/assembly-surfaces'

self.onmessage = (event: MessageEvent<AssemblyRasterRequest & { id: number }>) => {
  const pixels = assemblyRaster(event.data)
  self.postMessage({ id: event.data.id, width: event.data.width, height: event.data.height, pixels: pixels.buffer }, { transfer: [pixels.buffer] })
}
