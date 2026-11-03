import { join } from 'node:path'

export function extensionHostEntry(packaged: boolean, resourcesDirectory: string, mainDirectory: string): string {
  // utilityProcess 的入口与相邻构建块一起解包，不依赖源码目录或当前工作目录。
  return packaged
    ? join(resourcesDirectory, 'app.asar.unpacked', 'out', 'main', 'extension-host.js')
    : join(mainDirectory, 'extension-host.js')
}
