import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { loadAssemblyFonts } from '../src/renderer/src/features/assembly/assembly-fonts.ts'

test('字幕字体按公共清单去重加载，空工程不等待字体', async () => {
  const requests: string[] = []
  const fontSet = { load: async (font: string) => { requests.push(font); return [{}] } }
  await loadAssemblyFonts(['song', 'song', 'sans'], fontSet)
  assert.deepEqual(requests, ['16px "Noto Serif CJK SC"', '16px "Noto Sans CJK SC"'])
  requests.length = 0
  await loadAssemblyFonts([], fontSet)
  assert.equal(requests.length, 0)
})

test('字体缺失和加载失败不伪装成功，后续调用允许重新加载', async () => {
  await assert.rejects(loadAssemblyFonts(['song'], { load: async () => [] }), /字体未载入/)
  let attempts = 0
  const fontSet = { load: async () => { if (++attempts === 1) throw new Error('字体网络错误'); return [{}] } }
  await assert.rejects(loadAssemblyFonts(['song'], fontSet), /字体网络错误/)
  await loadAssemblyFonts(['song'], fontSet)
  assert.equal(attempts, 2)
})

test('CSS字体引用真实本地资源，交给Vite处理而非误写自定义协议为磁盘路径', async () => {
  const cssUrl = new URL('../src/renderer/src/features/assembly/assembly.css', import.meta.url)
  const css = await readFile(cssUrl, 'utf8')
  const fontUrls = [...css.matchAll(/src: url\('([^']+\.otf)'\)/g)].map((match) => match[1]!)
  assert.equal(fontUrls.length, 2)
  assert.doesNotMatch(css, /workbench-asset:\/\/fonts\//)
  for (const path of fontUrls) assert.ok((await stat(new URL(path, cssUrl))).size > 0)
})
