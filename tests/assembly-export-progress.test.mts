import test from 'node:test'
import assert from 'node:assert/strict'
import { FfmpegProgressParser } from '../src/main/modules/assembly/adapters/ffmpeg-progress.ts'
import { exportCanvas } from '../src/main/modules/assembly/adapters/assembly-export-options.ts'
import { assemblyExportOptionsSchema, assemblyExportProgressSchema, defaultAssemblyExportOptions } from '../src/shared/contracts/assembly-export.ts'

test('FFmpeg进度跨管道分块，旧版毫秒字段实际也按微秒读取', () => {
  const updates: { seconds: number; speed?: number }[] = []
  const parser = new FfmpegProgressParser((progress) => updates.push(progress))
  parser.push('out_time_u')
  parser.push('s=1500000\r\nspeed=0.75x\r\nprogr')
  assert.equal(updates.length, 0)
  parser.push('ess=continue\r\nout_time_ms=2500000\nspeed=N/A\nprogress=end\n')
  assert.deepEqual(updates, [{ seconds: 1.5, speed: 0.75 }, { seconds: 2.5 }])
})

test('进度忽略诊断路径和无效数值，不向界面传递NaN或负数', () => {
  const updates: { seconds: number; speed?: number }[] = []
  const parser = new FfmpegProgressParser((progress) => updates.push(progress))
  parser.push('file=C:/private/video.mp4\nout_time_us=N/A\nspeed=-1x\nprogress=continue\n')
  parser.push('out_time_us=-100\nspeed=Infinity\nprogress=end\n')
  assert.deepEqual(updates, [{ seconds: 0 }, { seconds: 0 }])
})

test('导出画布保持横竖比例与fit，尺寸为偶数，不修改工程画布', () => {
  const canvas = { width: 1920, height: 1080, fit: 'contain' as const }
  assert.deepEqual(exportCanvas(canvas, '720p'), { width: 1280, height: 720, fit: 'contain' })
  assert.deepEqual(exportCanvas({ ...canvas, width: 1080, height: 1920 }, '2160p'), { width: 2160, height: 3840, fit: 'contain' })
  assert.deepEqual(canvas, { width: 1920, height: 1080, fit: 'contain' })
  assert.throws(() => exportCanvas({ ...canvas, width: 3840, height: 1080 }, '2160p'), /4096/)
})

test('导出参数只允许受支持的编码枚举和画质范围', () => {
  assert.ok(assemblyExportOptionsSchema.safeParse(defaultAssemblyExportOptions).success)
  for (const override of [{ crf: 13 }, { crf: 30.5 }, { crf: NaN }, { preset: 'fast -i file' }, { audioBitrate: '999k' }, { extra: true }]) {
    assert.equal(assemblyExportOptionsSchema.safeParse({ ...defaultAssemblyExportOptions, ...override }).success, false)
  }
})

test('进度契约拒绝越界、非有限值和错误请求ID', () => {
  const progress = { requestId: '6cae89f8-e3f0-446a-b584-d3e7b91e42bd', stage: 'rendering', percent: 12, stagePercent: null, detail: '处理片段', elapsedSeconds: 1 }
  assert.ok(assemblyExportProgressSchema.safeParse(progress).success)
  for (const override of [{ percent: 101 }, { elapsedSeconds: -1 }, { speed: Infinity }, { requestId: 'wrong' }]) {
    assert.equal(assemblyExportProgressSchema.safeParse({ ...progress, ...override }).success, false)
  }
})
