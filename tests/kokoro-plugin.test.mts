import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseExtensionManifest } from '../src/main/modules/extensions/domain/manifest.ts'
import { extensionHostEntry } from '../src/main/infrastructure/extensions/host-path.ts'

test('Kokoro 测试插件声明真实能力，不声称支持克隆、情绪或云端', async () => {
  const manifest = parseExtensionManifest(JSON.parse(await readFile(resolve('extensions/kokoro-test/extension.json'), 'utf8')))
  assert.equal(manifest.publisher + '.' + manifest.name, 'workbench.kokoro-test')
  assert.deepEqual(manifest.permissions, ['models.local'])
  assert.equal(manifest.contributes.commands.length, 2)
  assert.deepEqual(manifest.contributes.speechProviders[0]?.capabilities, { presetVoices: true, voiceCloning: false, emotion: false })
  assert.ok(manifest.contributes.configuration.some(field => field.key === 'runtime-directory' && field.required))
})

test('打包与开发插件宿主入口不依赖 process.cwd 或源码目录', () => {
  assert.equal(extensionHostEntry(true, resolve('虚拟安装目录/resources'), resolve('other')),
    resolve('虚拟安装目录/resources/app.asar.unpacked/out/main/extension-host.js'))
  assert.equal(extensionHostEntry(false, resolve('unused'), resolve('out/main')), resolve('out/main/extension-host.js'))
})
