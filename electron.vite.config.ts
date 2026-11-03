import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const contractAliases = {
  '@contracts': resolve('src/shared/contracts')
}

// 将 CSP 写入 HTML，确保打包后的 file:// 页面也受约束。
const rendererSecurityPolicy: Plugin = {
  name: 'renderer-security-policy',
  transformIndexHtml(_html, context) {
    const development = Boolean(context.server)
    const policy = [
      "default-src 'self'",
      `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: workbench-asset:",
      "media-src 'self' data: blob: workbench-asset: https://rh-images.xiaoyaoyou.com https://rh-images-1252422369.cos.ap-beijing.myqcloud.com https://rh-comfyui01.tos-cn-beijing.volces.com",
      "font-src 'self' workbench-asset://fonts",
      "worker-src 'self' blob:",
      // 本地媒体统一交给受控协议校验；允许 Blob 解码，不扩大到任意网络或磁盘。
      `connect-src 'self' workbench-asset: blob:${development ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-src 'none'"
    ].join('; ')

    return [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
      injectTo: 'head-prepend'
    }]
  }
}

export default defineConfig({
  main: {
    resolve: { alias: contractAliases },
    build: { externalizeDeps: { exclude: ['zod'] }, rollupOptions: {
      input: { index: resolve('src/main/index.ts'), 'extension-host': resolve('src/main/infrastructure/extensions/host-entry.ts') },
      output: { entryFileNames: '[name].js' },
      external: ['node:sqlite']
    } }
  },
  preload: {
    resolve: { alias: contractAliases },
    // 沙箱预加载不能 require 第三方包，通知校验依赖须内联打包。
    build: { externalizeDeps: { exclude: ['zod'] } }
  },
  renderer: {
    resolve: {
      alias: {
        ...contractAliases,
        '@': resolve('src/renderer/src')
      }
    },
    server: { host: '127.0.0.1', port: 5188, strictPort: true },
    plugins: [react(), tailwindcss(), rendererSecurityPolicy]
  }
})
