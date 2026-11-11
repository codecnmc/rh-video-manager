import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkflowUsage } from '../src/main/providers/runninghub/workflow-usage.ts'

test('保存平台任务积分与执行时长，不推算金额或累加子任务', () => {
  assert.deepEqual(parseWorkflowUsage({ chargedPoint: '1.28', taskCostTime: '12' }), { points: '1.28', executionSeconds: 12 })
  assert.deepEqual(parseWorkflowUsage({ chargedPoint: 0, taskCostTime: 0 }), { points: '0', executionSeconds: 0 })
})
test('缺失和异常的消耗数据保留未知', () => {
  assert.deepEqual(parseWorkflowUsage(undefined), { points: null, executionSeconds: null })
  assert.deepEqual(parseWorkflowUsage({ chargedPoint: '-1', taskCostTime: 'invalid' }), { points: null, executionSeconds: null })
})
