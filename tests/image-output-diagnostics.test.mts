import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalImageOutputStore } from '../src/main/modules/image-generation/adapters/image-output-store.ts'

test('图片结果诊断不下载、不暴露签名或路径，真实私网 IP 继续阻止', async () => {
  const gateway = new LocalImageOutputStore('unused')
  const inline = await gateway.diagnoseOutput({ b64_json: 'secret-image-bytes' }, 'https://provider.example.com')
  assert.equal(inline.kind, 'inline')
  assert.equal(inline.network, 'not_needed')
  assert.doesNotMatch(JSON.stringify(inline), /secret-image-bytes/)
  const blocked = await gateway.diagnoseOutput({ url: 'https://127.0.0.1/private/image.png?signature=secret' }, 'https://provider.example.com')
  assert.equal(blocked.network, 'blocked')
  assert.equal(blocked.fakeIpAllowed, false)
  assert.equal(blocked.downloadOrigin, 'https://127.0.0.1')
  assert.doesNotMatch(JSON.stringify(blocked), /signature|secret|private\/image/)
})
