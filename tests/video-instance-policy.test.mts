import test from 'node:test'
import assert from 'node:assert/strict'
import { selectInstanceTier } from '../src/renderer/src/features/video/instance-policy.ts'
import { videoDraftSchema } from '../src/shared/contracts/video.ts'

test('自动档位：5 秒且至多 3 张图为 Lite，超过任一阈值为 Plus', () => {
  const draft = { duration: 5, instance: 'default' as const, instanceMode: 'auto' as const }
  assert.equal(selectInstanceTier(draft, 0), 'default')
  assert.equal(selectInstanceTier(draft, 3), 'default')
  assert.equal(selectInstanceTier({ ...draft, duration: 4 }, 4), 'plus')
  assert.equal(selectInstanceTier(draft, 4), 'plus')
  assert.equal(selectInstanceTier({ ...draft, duration: 6 }, 0), 'plus')
  assert.equal(selectInstanceTier({ ...draft, duration: 15 }, 9), 'plus')
  assert.equal(selectInstanceTier({ ...draft, instance: 'ultra' }, 3), 'default')
})

test('手动档位不被时长与图片数量覆盖，恢复自动后重新应用规则', () => {
  for (const instance of ['default', 'plus', 'ultra'] as const) {
    assert.equal(selectInstanceTier({ duration: 15, instance, instanceMode: 'manual' }, 9), instance)
    assert.equal(selectInstanceTier({ duration: 4, instance, instanceMode: 'manual' }, 0), instance)
    assert.equal(selectInstanceTier({ duration: 15, instance, instanceMode: 'auto' }, 9), 'plus')
  }
})

test('自动档位只派生计算，不改写已保存的实例值', () => {
  const draft = Object.freeze({ duration: 5, instance: 'plus' as const, instanceMode: 'auto' as const })
  assert.equal(selectInstanceTier(draft, 1), 'default')
  assert.equal(draft.instance, 'plus')
  assert.equal(selectInstanceTier(draft, 4), 'plus')
  assert.equal(draft.instance, 'plus')
})

test('旧草稿缺少选择模式时保留原档位，新增自动模式可序列化', () => {
  const legacy = videoDraftSchema.parse({ id: '00000000-0000-4000-8000-000000000001', title: '旧草稿', description: '',
    prompt: '', promptDocument: '', duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'ultra' })
  assert.equal(legacy.instanceMode, 'manual')
  assert.equal(selectInstanceTier(legacy, 0), 'ultra')
  assert.equal(videoDraftSchema.parse(JSON.parse(JSON.stringify({ ...legacy, instanceMode: 'auto' }))).instanceMode, 'auto')
})
