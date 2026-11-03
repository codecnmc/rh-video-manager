import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { WorkflowService } from '../src/main/modules/workflows/application/workflow-service.ts'
import { SqliteWorkflowRepository } from '../src/main/infrastructure/database/workflow-repository.ts'
import { migrateWorkbench } from '../src/main/infrastructure/database/migrations.ts'
import { validPromptDocument } from '../src/shared/contracts/prompt-document.ts'
import type { PreviewCapabilities } from '../src/shared/contracts/preview.ts'

const accountA = '00000000-0000-4000-8000-000000000001'
const accountB = '00000000-0000-4000-8000-000000000002'
const capabilities: PreviewCapabilities = { status: 'ready', sampling: true, draft: true, final: true, unclassifiedOutputs: 0 }

function setup(legacy = false) {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE workspace_meta (singleton INTEGER PRIMARY KEY, revision INTEGER, updated_at TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE episodes (id TEXT PRIMARY KEY, project_id TEXT, sort_order INTEGER);
    CREATE TABLE shots (id TEXT PRIMARY KEY, episode_id TEXT, sort_order INTEGER);
    CREATE TABLE shot_references (id TEXT PRIMARY KEY, shot_id TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, workflow_id TEXT UNIQUE NOT NULL, is_default INTEGER NOT NULL, data TEXT NOT NULL);
    INSERT INTO accounts VALUES ('${accountA}'), ('${accountB}');`)
  if (legacy) {
    const id = '00000000-0000-4000-8000-000000000099'
    db.prepare('INSERT INTO workflows VALUES (?, ?, 1, ?)').run(id, '123456789', JSON.stringify({
      id, name: '旧配置', workflowId: '123456789', enabled: true, isDefault: true, checkedAt: null, error: '', capabilities: null
    }))
  }
  migrateWorkbench(db, 2)
  let sequence = 0
  const repository = new SqliteWorkflowRepository(db)
  const service = new WorkflowService(repository, { inspect: async () => capabilities }, () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`)
  return { db, service }
}

test('不同账号允许相同或不同私有 ID，同账号拒绝重复 ID', () => {
  const { db, service } = setup()
  try {
    const input = { id: null, accountId: accountA, name: 'H3', workflowId: '123456789', enabled: true, isDefault: true }
    service.save(input)
    service.save({ ...input, accountId: accountB })
    service.save({ ...input, accountId: accountB, workflowId: '987654321', isDefault: false })
    assert.equal(service.list().length, 3)
    assert.throws(() => service.save(input))
    assert.equal(service.list().filter((workflow) => workflow.isDefault).length, 2)
    service.save({ ...input, workflowId: '111111111' })
    assert.equal(service.list().find((workflow) => workflow.accountId === accountB && workflow.isDefault)?.workflowId, '123456789')
    assert.equal(service.list().filter((workflow) => workflow.accountId === accountA && workflow.isDefault).length, 1)
    const owned = service.list().find((workflow) => workflow.accountId === accountA)!
    assert.equal(service.forAccount(owned.id, accountA).workflowId, owned.workflowId)
    assert.throws(() => service.forAccount(owned.id, accountB), /不属于所选账号/)
  } finally { db.close() }
})

test('迁移保留旧配置但不猜账号，也不保留全局默认', () => {
  const { db } = setup(true)
  try {
    const old = new SqliteWorkflowRepository(db).list()[0]!
    assert.equal(old.accountId, null)
    assert.equal(old.enabled, false)
    assert.equal(old.isDefault, false)
  } finally { db.close() }
})

test('工作流换账号时清除旧检测结果', async () => {
  const { db, service } = setup()
  try {
    const input = { id: null, accountId: accountA, name: 'H3', workflowId: '123456789', enabled: true, isDefault: false }
    const saved = service.save(input)[0]!
    await service.inspect(saved.id, 'test-only-key')
    assert.equal(service.get(saved.id).capabilities?.sampling, true)
    service.save({ ...input, id: saved.id, accountId: accountB })
    assert.equal(service.get(saved.id).capabilities, null)
  } finally { db.close() }
})

test('富文本仅接纳允许的节点与引用标签', () => {
  assert.equal(validPromptDocument(''), true)
  assert.equal(validPromptDocument(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'promptReference', attrs: { label: '<Picture 1>' } }] }] })), true)
  assert.equal(validPromptDocument(JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'file:///private' } }] })), false)
  assert.equal(validPromptDocument(JSON.stringify({ type: 'doc', content: [{ type: 'promptReference', attrs: { label: '<script>' } }] })), false)
})
