import { dialog } from 'electron'
import { productionScopeSchema, dialoguePlanSchema, generateDialogueSchema, productionTakeActionSchema, adoptDialogueSchema, saveCharacterVoiceSchema } from '../../shared/contracts/production'
import type { ProductionService } from '../modules/production'
import type { DesktopHandle } from './handle'

export function registerProduction(handle: DesktopHandle, production: ProductionService): void {
  handle('production:capabilities', async () => production.capabilities())
  handle('production:tasks', async () => production.listTasks())
  handle('production:load', async (input) => production.load(productionScopeSchema.parse(input)))
  handle('production:save', async (input) => production.save(dialoguePlanSchema.parse(input)))
  handle('production:voice-binding', async (input) => production.saveCharacterVoice(saveCharacterVoiceSchema.parse(input)))
  handle('production:generate', async (input, window) => {
    const parsed = generateDialogueSchema.parse(input)
    const { plan } = await production.load(parsed)
    const line = plan.lines.find((item) => item.id === parsed.lineId)
    const provider = production.capabilities().find((item) => item.extensionId === line?.extensionId && item.provider.id === line.providerId)
    let cloudConsentKey: string | undefined
    if (provider?.provider.runtime === 'cloud') {
      const confirmation = await dialog.showMessageBox(window, { type: 'warning', title: '调用云端语音引擎',
        message: `将向「${provider.extensionName}」发送这句台词及语音参数。`,
        detail: '云端服务可能产生费用。取消本地任务不保证远端取消或退款。仅提交这一句，不会提交视频任务。',
        buttons: ['取消', '确认调用'], defaultId: 0, cancelId: 0 })
      if (confirmation.response !== 1) throw new Error('已取消云端调用')
      cloudConsentKey = provider.configurationKey
    }
    return production.generate(parsed, cloudConsentKey)
  })
  handle('production:cancel', async (input) => production.cancel(productionTakeActionSchema.parse(input)))
  handle('production:adopt', async (input) => production.adopt(adoptDialogueSchema.parse(input)))
}
