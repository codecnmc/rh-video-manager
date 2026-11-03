import { z } from 'zod'
import type { AccountGateway } from '../../modules/accounts'
import { accountQueueSchema, type AccountQueue } from '../../../shared/contracts/accounts'

const decimal = z.string().regex(/^-?\d{1,30}(?:\.\d{1,8})?$/)
const balanceSchema = z.object({
  code: z.literal(0), data: z.object({
    remainCoins: decimal, currentTaskCounts: z.string().regex(/^\d{1,6}$/),
    remainMoney: decimal.nullable(), currency: z.string().regex(/^[A-Z]{3,10}$/).nullable(), apiType: z.string().max(100)
  })
})

const countString = z.string().regex(/^\d{1,16}$/).transform(Number).pipe(z.number().int().nonnegative().safe())
const queueResponseSchema = z.object({
  code: z.literal(0), data: accountQueueSchema.extend({
    runningCount: countString, queuedCount: countString, totalCurrentTasks: countString
  })
})

export function parseQueueStatus(input: unknown): AccountQueue {
  const result = queueResponseSchema.safeParse(input)
  if (!result.success) throw new Error('队列响应格式不正确或查询失败')
  return result.data.data
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('账户查询失败')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 65536) throw new Error('账户响应过大')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class RunningHubAccountGateway implements AccountGateway {
  async status(key: string) {
    const response = await fetch('https://www.runninghub.cn/uc/openapi/accountStatus', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ apikey: key })
    })
    const { data } = balanceSchema.parse(await readResponse(response))
    return { coins: data.remainCoins, money: data.remainMoney, currency: data.currency,
      runningTasks: Number(data.currentTaskCounts), apiType: data.apiType }
  }

  async queue(key: string): Promise<AccountQueue> {
    const response = await fetch('https://www.runninghub.cn/openapi/v2/queue/status', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${key}` }
    })
    return parseQueueStatus(await readResponse(response))
  }
}
