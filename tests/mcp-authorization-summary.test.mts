import test from 'node:test'
import assert from 'node:assert/strict'
import { mcpAuthorizationSummary } from '../src/renderer/src/features/mcp/authorization-summary.ts'

const preferences = { projectId: null, allProjects: true, writeEnabled: true, minutes: -1, importDirectory: 'D:\\授权目录', scriptLibraryEnabled: true, assemblyEnabled: true, imageGenerationEnabled: false, imageSubmissionEnabled: false }

test('MCP 全部授权合并为同一份确认摘要，保留范围、能力及限制', () => {
  const message = mcpAuthorizationSummary(preferences, '', -1)
  for (const text of ['含后续新增项目', '公共素材', '剧本库：', '排片剪辑库：', '声音绑定', '不限时', preferences.importDirectory, '不包含删除', '付费生成']) assert.ok(message.includes(text))
  assert.equal(message.match(/确认开启/g)?.length, 1)
})

test('只读及未勾选的模块不会在确认摘要中变成写授权', () => {
  const message = mcpAuthorizationSummary({ ...preferences, allProjects: false, writeEnabled: false, scriptLibraryEnabled: false, assemblyEnabled: false }, '短片', 30)
  assert.ok(message.includes('项目「短片」'))
  assert.ok(message.includes('剧本库：未授权'))
  assert.ok(message.includes('排片剪辑库：未授权'))
  assert.ok(message.includes('30 分钟'))
  assert.ok(!message.includes('导入目录：'))
  assert.ok(!message.includes('读写'))
})

test('素材生成区分只读 DNS 诊断与已有图片下载恢复，不授权付费生成', () => {
  const read = mcpAuthorizationSummary({ ...preferences, imageGenerationEnabled: true, writeEnabled: false }, '', 30)
  assert.ok(read.includes('脱敏 DNS 诊断；不下载或生成'))
  const write = mcpAuthorizationSummary({ ...preferences, imageGenerationEnabled: true }, '', 30)
  assert.ok(write.includes('从已有服务结果恢复图片下载归档'))
  assert.ok(write.includes('不发起生图或上传'))
  assert.ok(write.includes('付费生成'))
})

test('独立生图提交授权明确不逐次确认，但不能扩大为视频提交或账号配置', () => {
  const message = mcpAuthorizationSummary({ ...preferences, imageGenerationEnabled: true, imageSubmissionEnabled: true }, '', 30)
  assert.ok(message.includes('允许自动排队执行'))
  assert.ok(message.includes('不设金额或提交次数额度'))
  assert.ok(message.includes('不逐次弹窗'))
  assert.ok(message.includes('视频付费生成'))
  assert.ok(message.includes('账号配置'))
})
