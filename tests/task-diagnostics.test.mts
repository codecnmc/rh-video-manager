import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskDiagnostics } from '../src/main/infrastructure/files/task-diagnostics.ts'

test('任务日志白名单脱敏、按任务隔离并在重启后读取', () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-diagnostics-'))
  try {
    const id = randomUUID()
    const logs = new TaskDiagnostics(directory)
    const entry = { id, taskId: '1234567890', event: 'output' as const, reason: 'domain-rejected' as const,
      host: 'unapproved.invalid', apiKey: 'SECRET', url: 'https://unapproved.invalid/video.mp4?token=SECRET', response: 'SECRET' }
    logs.append(entry)
    logs.append({ id: randomUUID(), taskId: '99999999', event: 'query', count: 0 })
    const exported = new TaskDiagnostics(directory).read(id)
    assert.ok(exported.includes('domain-rejected'))
    assert.equal(exported.includes('SECRET'), false)
    assert.equal(exported.includes('99999999'), false)
    const disk = readFileSync(join(directory, 'video-tasks.jsonl'), 'utf8')
    assert.equal(disk.includes('SECRET'), false)
    assert.throws(() => logs.read(randomUUID()), /暂无诊断日志/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('任务日志轮转仅保留两份，不影响后续写入', () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-diagnostics-'))
  try {
    const id = randomUUID()
    const logs = new TaskDiagnostics(directory, 400)
    for (let index = 0; index < 20; index += 1) logs.append({ id, taskId: '1234567890', event: 'query', count: index })
    assert.equal(readdirSync(directory).length, 2)
    const entries = logs.read(id).trim().split('\n').map((line) => JSON.parse(line) as { count: number })
    assert.ok(entries.length < 20)
    assert.equal(entries.at(-1)?.count, 19)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('日志无法写入时不抛出到任务，导出明确报错', () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-diagnostics-'))
  try {
    const id = randomUUID()
    const logs = new TaskDiagnostics(join(directory, 'blocked'))
    // 先写有效文件，再将该文件作为目录使用，稳定模拟 ENOTDIR。
    logs.append({ id, taskId: '1234567890', event: 'query' })
    const blocked = new TaskDiagnostics(join(directory, 'blocked', 'video-tasks.jsonl'))
    assert.doesNotThrow(() => blocked.append({ id, taskId: '1234567890', event: 'query' }))
    assert.throws(() => blocked.read(id), /日志写入失败/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('播放 CSP 明确允许 TOS 单域，不开放整个对象存储服务', () => {
  const config = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
  assert.match(config, /media-src[^\n]+https:\/\/rh-comfyui01\.tos-cn-beijing\.volces\.com/)
  assert.equal(config.includes('https://*.volces.com'), false)
})
