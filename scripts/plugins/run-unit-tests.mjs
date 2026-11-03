import { build } from 'vite'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const names = ['extensions', 'extension-packages', 'extension-storage', 'kokoro-plugin', 'production', 'workspace-migration', 'workbench-library', 'asset-mcp']
const output = join(root, '.cache/plugin-unit-tests')
// 复用项目 Vite 转译 TS 测试，避免改变 Electron 项目的模块模式。
await build({
  configFile: false,
  build: {
    target: 'node22', outDir: output, emptyOutDir: false, minify: false,
    rollupOptions: {
      input: Object.fromEntries(names.map(name => [name, join(root, `tests/${name}.test.mts`)])),
      external: [...builtinModules, ...builtinModules.map(name => `node:${name}`), 'node:test', 'node:sqlite'],
      output: { format: 'es', entryFileNames: '[name].test.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' }
    }
  }
})
const result = spawnSync(process.execPath, ['--test', ...names.map(name => join(output, `${name}.test.mjs`))], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
