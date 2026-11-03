import test from 'node:test'
import assert from 'node:assert/strict'
import { allowsImageFakeIp, isImageFakeIp, imageResultTrustOrigin } from '../src/main/modules/image-generation/adapters/image-network-policy.ts'

test('Fake-IP 兼容只识别 198.18.0.0/15，不放行其他私网、回环或非法地址', () => {
  for (const address of ['198.18.0.54', '198.18.0.0', '198.19.255.255']) assert.equal(isImageFakeIp(address), true)
  for (const address of ['198.17.0.1', '198.20.0.1', '198.18.999.1', '127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1']) {
    assert.equal(isImageFakeIp(address), false)
  }
})

test('已有服务结果允许 CDN Fake-IP，但拒绝无服务来源、IP 字面量、本地域名、非 HTTPS、凭据和非标准端口', () => {
  const service = 'https://provider.example.com'
  const cdn = new URL('https://cdn.example.com/image.png?signature=secret')
  assert.equal(imageResultTrustOrigin(cdn, service), 'https://cdn.example.com')
  assert.equal(allowsImageFakeIp(cdn, imageResultTrustOrigin(cdn, service)), true)
  assert.equal(imageResultTrustOrigin(cdn, null), null)
  for (const target of ['http://cdn.example.com/image.png', 'https://198.18.0.54/image.png', 'https://127.0.0.1/image.png',
    'https://localhost/image.png', 'https://test.local/image.png', 'https://test.internal/image.png',
    'https://user:secret@cdn.example.com/image.png', 'https://cdn.example.com:8443/image.png']) {
    assert.equal(imageResultTrustOrigin(new URL(target), service), null)
  }
})

test('仅已授权 HTTPS 服务同源域名可使用 Fake-IP，下载地址默认不获得信任', () => {
  const origin = 'https://provider.example.com'
  assert.equal(allowsImageFakeIp(new URL(`${origin}/v1/images/edits`), origin), true)
  assert.equal(allowsImageFakeIp(new URL(`${origin}/image.png`), origin), true)
  assert.equal(allowsImageFakeIp(new URL(`${origin}/image.png`), null), false)
  assert.equal(allowsImageFakeIp(new URL('https://cdn.example.com/image.png'), origin), false)
  assert.equal(allowsImageFakeIp(new URL('http://provider.example.com'), origin), false)
  for (const target of ['https://198.18.0.54', 'https://localhost', 'https://test.local', 'https://test.localhost', 'https://test.internal']) {
    assert.equal(allowsImageFakeIp(new URL(target), target), false)
  }
})
