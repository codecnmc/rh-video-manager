import { dialog } from 'electron'
import { createVoiceSchema, renameVoiceSchema, deleteVoiceSchema } from '../../shared/contracts/voices'
import type { VoiceService } from '../modules/voices'
import type { DesktopHandle } from './handle'
import { referenceExtensions } from '../infrastructure/files/reference-files'

export function registerVoices(handle: DesktopHandle, voices: VoiceService): void {
  handle('voices:list', async () => voices.list())
  handle('voices:rename', async (input) => voices.rename(renameVoiceSchema.parse(input)))
  handle('voices:delete', async (input) => voices.remove(deleteVoiceSchema.parse(input)))
  handle('voices:from-asset', async (input) => voices.fromAsset(createVoiceSchema.parse(input)))
  handle('voices:import', async (_input, window) => {
    const selection = await dialog.showOpenDialog(window, { title: '导入公共参考音色', properties: ['openFile', 'multiSelections'], filters: [{ name: '音频', extensions: referenceExtensions.audio }] })
    return selection.canceled ? [] : voices.import(selection.filePaths)
  })
}
