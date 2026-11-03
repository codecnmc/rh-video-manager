import test from 'node:test'
import assert from 'node:assert/strict'
import { generatedVideoName } from '../src/shared/media-naming.ts'

test('成片名称按提交时间稳定命名且可辨识先后，不依赖下载时间', () => {
  const early = generatedVideoName('第二段｜招呼', '12345678-abcd', '2026-10-23T03:30:00Z')
  const late = generatedVideoName('第二段｜招呼', '87654321-abcd', '2026-10-23T03:40:00Z')
  assert.equal(early, '第二段｜招呼-成片-20261023113000-12345678.mp4')
  assert.ok(early < late)
  assert.equal(early, generatedVideoName('第二段｜招呼', '12345678-abcd', '2026-10-23T11:30:00+08:00'))
})

test('成片名称过滤路径字符，错误日期不伪造生成时间', () => {
  const name = generatedVideoName('../A:B/C', '12345678-abcd', 'invalid')
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(name))
  assert.ok(name.includes('时间未知'))
})
