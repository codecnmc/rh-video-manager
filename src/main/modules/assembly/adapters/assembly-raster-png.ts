import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { assemblyRaster, type AssemblyRasterRequest } from '../../../../shared/assembly-surfaces'

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  let crc = 0xffffffff
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, name, data, checksum])
}

// PNG RGBA/8、无交错、逐行 filter=0；只编码本应用生成的有限尺寸像素，不解析外部文件。
export function encodeAssemblyPng(request: AssemblyRasterRequest): Buffer {
  const pixels = assemblyRaster(request)
  const stride = request.width * 4
  const rows = Buffer.alloc((stride + 1) * request.height)
  for (let y = 0; y < request.height; y++) rows.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(request.width, 0); header.writeUInt32BE(request.height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

export async function writeAssemblyRaster(path: string, request: AssemblyRasterRequest): Promise<void> {
  await writeFile(path, encodeAssemblyPng(request))
}
