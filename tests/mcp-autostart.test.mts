import test from 'node:test'
import assert from 'node:assert/strict'
import { startRememberedMcp } from '../src/main/application/start-remembered-mcp.ts'
import type { AppPreferences } from '../src/shared/contracts/settings.ts'
import type { AssetMcpPreferences } from '../src/shared/contracts/mcp.ts'

const preferences: AppPreferences = { editorMode: 'split', editorFontSize: 14, taskNotifications: false }
const remembered: AssetMcpPreferences = { projectId: 'f2018d01-0101-4010-8010-010101010101', allProjects: false,
  writeEnabled: true, minutes: 60, importDirectory: 'D:/mcp', scriptLibraryEnabled: false, assemblyEnabled: true, imageGenerationEnabled: false, imageSubmissionEnabled: false }

test('配置目录后缺省允许启动，保留项目、权限、时长和目录，不传令牌', async () => {
  let called = false
  assert.equal(await startRememberedMcp(preferences, remembered, async () => true, async (input, directory) => {
    called = true
    assert.equal(directory, remembered.importDirectory)
    assert.equal(input.projectId, remembered.projectId)
    assert.equal(input.writeEnabled, true)
    assert.equal(input.assemblyEnabled, true)
    assert.equal(input.scriptLibraryEnabled, false)
    assert.equal(input.minutes, 60)
    assert.equal(input.token, undefined)
  }), true)
  assert.equal(called, true)
})

test('关闭自动开启或未配置目录，不调用启动；删除项目不升级为全部项目', async () => {
  const unexpected = async () => { assert.fail('不应启动') }
  assert.equal(await startRememberedMcp({ ...preferences, mcpAutoStart: false }, remembered, async () => true, unexpected), false)
  assert.equal(await startRememberedMcp(preferences, { ...remembered, importDirectory: '' }, async () => true, unexpected), false)
  await assert.rejects(startRememberedMcp(preferences, remembered, async () => false, unexpected), /项目已不存在/)
  await assert.rejects(startRememberedMcp(preferences, { ...remembered, projectId: null }, async () => true, unexpected), /授权范围无效/)
})

test('保留明确的全部项目授权和不限时选项，失败不重试或降级', async () => {
  let calls = 0
  await assert.rejects(startRememberedMcp(preferences, { ...remembered, projectId: null, allProjects: true, minutes: -1 },
    async () => { assert.fail('全部项目不猜测单项目') }, async (input) => {
      calls++
      assert.equal(input.allProjects, true)
      assert.equal(input.minutes, -1)
      throw new Error('端口不可用')
    }), /端口不可用/)
  assert.equal(calls, 1)
})
