import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleEarlyPreviews } from '../src/renderer/src/features/workbench/preview-visibility.ts'
import type { PreviewCapabilities, PreviewMedia } from '../src/shared/contracts/preview.ts'

const capabilities: PreviewCapabilities = { status: 'ready', sampling: true, draft: false, final: true, unclassifiedOutputs: 0 }
const media: PreviewMedia = { source: 'https://example.com/preview.mp4', mime: 'video/mp4', receivedAt: '2026-11-09T00:00:00.000Z' }

test('依所选任务能力显示采样和低清，无低清能力时即使存在旧媒体也不显示低清区', () => {
  assert.deepEqual(visibleEarlyPreviews(undefined), [])
  assert.deepEqual(visibleEarlyPreviews({ capabilities, sampling: null, draft: media }), ['sampling'])
  assert.deepEqual(visibleEarlyPreviews({ capabilities: { ...capabilities, sampling: false, draft: true }, sampling: null, draft: null }), ['draft'])
  assert.deepEqual(visibleEarlyPreviews({ capabilities: { ...capabilities, sampling: false }, sampling: null, draft: null }), [])
})

test('能力检查中或失败时不虚构空预览，但保留已经收到的媒体入口', () => {
  for (const status of ['checking', 'failed'] as const) {
    assert.deepEqual(visibleEarlyPreviews({ capabilities: { ...capabilities, status }, sampling: null, draft: null }), [])
    assert.deepEqual(visibleEarlyPreviews({ capabilities: { ...capabilities, status }, sampling: media, draft: null }), ['sampling'])
  }
})
