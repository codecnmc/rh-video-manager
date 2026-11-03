import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReleaseUpdate } from '../src/main/modules/updates/index.ts'

const release = (tag: string): typeof fetch => async () => Response.json({ tag_name: tag, draft: false, prerelease: false })

test('正式版按数字比较而非字符串顺序', async () => {
  assert.equal((await checkReleaseUpdate('0.9.0', release('v0.10.0'))).available, true)
  assert.equal((await checkReleaseUpdate('0.10.0', release('v0.9.0'))).available, false)
  assert.equal((await checkReleaseUpdate('0.10.0', release('v0.10.0'))).available, false)
})

test('固定官方查询目标且不发送 GitHub 凭据', async () => {
  await checkReleaseUpdate('0.1.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/codecnmc/rh-video-manager/releases/latest')
    assert.equal(new Headers(options?.headers).has('Authorization'), false)
    assert.equal(options?.redirect, 'error')
    return Response.json({ tag_name: 'v0.2.0', draft: false, prerelease: false })
  })
})

test('不可访问和限流不误报为最新版', async () => {
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => new Response(null, { status: 404 })), /私有/)
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => new Response(null, { status: 403 })), /访问受限/)
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => { throw new Error('network') }), /无法连接/)
})

test('不接受非法版本、草稿和预发布元数据', async () => {
  await assert.rejects(checkReleaseUpdate('0.1.0', release('v0.2.0-beta.1')), /版本格式/)
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => Response.json({ tag_name: 'v0.2.0', draft: true, prerelease: false })), /格式/)
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => Response.json({ tag_name: 'v0.2.0', draft: false, prerelease: true })), /格式/)
  await assert.rejects(checkReleaseUpdate('0.1.0', async () => new Response('x'.repeat(1024 * 1024 + 1))), /格式/)
})
