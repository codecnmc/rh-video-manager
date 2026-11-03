const { Arch } = require('electron-builder')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32' || context.arch !== Arch.x64) {
    throw new Error('The bundled media engine supports Windows x64 packaging only')
  }
  const { prepareMediaEngine } = await import(pathToFileURL(join(__dirname, 'prepare.mjs')).href)
  await prepareMediaEngine()
}
