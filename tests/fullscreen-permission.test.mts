import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseMediaFullscreen } from '../src/main/bootstrap/fullscreen-permission.ts'

test('只允许本地应用文档的顶层手动全屏，保留剪辑窗口 hash', () => {
  const input = { permission: 'fullscreen', requestingUrl: 'file:///D:/app/renderer/index.html#assembly', topLevelUrl: 'file:///D:/app/renderer/index.html#assembly', rendererDocumentUrl: 'file:///D:/app/renderer/index.html', isMainFrame: true }
  assert.equal(canUseMediaFullscreen(input), true)
  for (const change of [
    { permission: 'media' }, { permission: 'automatic-fullscreen' }, { permission: 'clipboard-read' },
    { isMainFrame: false }, { requestingUrl: 'file:///D:/other/index.html' },
    { requestingUrl: 'https://www.runninghub.cn' }, { topLevelUrl: 'https://example.com' }, { requestingUrl: '' }
  ]) assert.equal(canUseMediaFullscreen({ ...input, ...change }), false)
})

test('开发页面只接受相同服务器与入口，不放宽到任意回环地址', () => {
  const input = { permission: 'fullscreen', requestingUrl: 'http://localhost:5173/#assembly', topLevelUrl: 'http://localhost:5173/', rendererDocumentUrl: 'http://localhost:5173', isMainFrame: true }
  assert.equal(canUseMediaFullscreen(input), true)
  for (const requestingUrl of ['http://localhost:5174/', 'http://127.0.0.1:5173/', 'http://localhost:5173/other', 'http://localhost:5173/?other=1']) {
    assert.equal(canUseMediaFullscreen({ ...input, requestingUrl }), false)
  }
})
