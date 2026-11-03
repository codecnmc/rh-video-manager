import { pastedImageMaxBytes, pastedImageSchema, pastedImagesSchema } from '@contracts/references'

export async function readPastedImages(files: File[]) {
  if (!files.length || files.length > 9) throw new Error('每次导入 1–9 张图片')
  for (const file of files) {
    if (!pastedImageSchema.shape.mimeType.safeParse(file.type).success) throw new Error('仅支持 PNG、JPEG 和 WebP 图片')
    if (!file.size || file.size > pastedImageMaxBytes) throw new Error('图片为空或超过 10 MB 上限')
  }
  return pastedImagesSchema.parse(await Promise.all(files.map(async (file, index) => ({
    name: (file.name || `图片-${index + 1}`).slice(0, 150), mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer())
  }))))
}
