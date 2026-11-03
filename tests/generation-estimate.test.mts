import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { generationTimingSampleSchema, videoDraftSchema } from '../src/shared/contracts/video.ts'
import { SqliteVideoDraftRepository } from '../src/main/infrastructure/database/video-repository.ts'
import { estimateGenerationTime, formatGenerationTime } from '../src/renderer/src/features/video/generation-estimate.ts'

const sample = generationTimingSampleSchema.parse({ workflowLabel: '用户实测工作流 v1', duration: 5, resolution: '720P', aspectRatio: '16:9', instance: 'plus', images: 2, videos: 0, audio: 0, minSeconds: 120, maxSeconds: 180 })
const config = { duration: 5, resolution: '720P' as const, aspectRatio: '16:9' as const, instance: 'plus' as const, images: 2, videos: 0, audio: 0 }

test('没有用户实测数据时不返回虚构耗时；空值和越界时长不参与估时', () => {
  assert.equal(estimateGenerationTime(config, undefined), null)
  assert.equal(estimateGenerationTime(config, []), null)
  for (const duration of [Number.NaN, 0, 3, 16, 5.5, Number.POSITIVE_INFINITY]) {
    assert.equal(estimateGenerationTime({ ...config, duration }, [sample]), null)
  }
})

test('仅按同一配置的实测基准线性换算成片时长，不宣称排队或总完成时间', () => {
  assert.deepEqual(estimateGenerationTime(config, [sample]), { minSeconds: 120, maxSeconds: 180, workflowLabel: sample.workflowLabel, scaled: false })
  assert.deepEqual(estimateGenerationTime({ ...config, duration: 10 }, [sample]), { minSeconds: 240, maxSeconds: 360, workflowLabel: sample.workflowLabel, scaled: true })
  assert.equal(estimateGenerationTime(config, [sample, { ...sample, minSeconds: 100, maxSeconds: 150 }])?.maxSeconds, 150)
})

test('档位、分辨率、比例或任一参考数量变化后不套用旧基准', () => {
  assert.equal(estimateGenerationTime({ ...config, instance: 'default' }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, instance: 'ultra' }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, resolution: '1080P' }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, aspectRatio: '9:16' }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, images: 3 }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, videos: 1 }, [sample]), null)
  assert.equal(estimateGenerationTime({ ...config, audio: 1 }, [sample]), null)
})

test('基准拒绝空名称、反向范围及无效耗时，最多二十组且兼容旧草稿', () => {
  assert.equal(generationTimingSampleSchema.safeParse({ ...sample, workflowLabel: ' ' }).success, false)
  assert.equal(generationTimingSampleSchema.safeParse({ ...sample, minSeconds: 181 }).success, false)
  for (const maxSeconds of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, 86401]) {
    assert.equal(generationTimingSampleSchema.safeParse({ ...sample, maxSeconds }).success, false)
  }
  const legacy = { id: '00000000-0000-4000-8000-000000000001', title: '草稿', description: '', prompt: '', promptDocument: '', duration: 8, resolution: '720P', aspectRatio: '16:9', instance: 'plus' }
  assert.equal(videoDraftSchema.parse(legacy).timingSamples, undefined)
  assert.equal(videoDraftSchema.safeParse({ ...legacy, timingSamples: Array.from({ length: 21 }, () => sample) }).success, false)
})

test('耗时基准随草稿在 SQLite 保存重读，不使用 localStorage', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE video_drafts (id TEXT PRIMARY KEY, project_id TEXT, sort_order INTEGER, data TEXT)')
    const repository = new SqliteVideoDraftRepository(db)
    const draft = videoDraftSchema.parse({ id: '00000000-0000-4000-8000-000000000001', title: '草稿', description: '', prompt: '', promptDocument: '', ...config, timingSamples: [sample] })
    repository.upsert('project', draft, 0)
    assert.deepEqual(new SqliteVideoDraftRepository(db).list('project')[0]?.timingSamples, [sample])
  } finally { db.close() }
})

test('耗时格式覆盖秒、分钟与小时', () => {
  assert.equal(formatGenerationTime(30), '30 秒')
  assert.equal(formatGenerationTime(120), '2 分钟')
  assert.equal(formatGenerationTime(3600), '1 小时')
  assert.equal(formatGenerationTime(3660), '1 小时 1 分钟')
})
