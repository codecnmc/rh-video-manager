import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { WindowClosePrompts } from '../src/main/bootstrap/window-close-prompts.ts'
import { windowCloseDecisionSchema } from '../src/shared/contracts/window-close.ts'

function fixture(id = 1) {
  const messages: unknown[] = []
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (_channel: string, input: unknown) => { messages.push(input) }
  })
  const window = Object.assign(new EventEmitter(), { id, isDestroyed: () => false, webContents: contents })
  return { window, target: window as unknown as BrowserWindow, contents, messages }
}

test('退出确认按窗口及请求编号绑定，拒绝跨窗口、过期回复和重复授权', async () => {
  const prompts = new WindowClosePrompts()
  const f = fixture()
  assert.equal(prompts.isReady(1), false)
  assert.equal(prompts.connect(1), null)
  assert.equal(prompts.isReady(1), true)
  const result = prompts.request(f.target, true)
  const request = prompts.current(1)!
  assert.equal(prompts.request(f.target, true), result)
  assert.equal(f.messages.length, 1)
  assert.throws(() => prompts.respond(2, { id: request.id, confirmed: true }), /已失效/)
  assert.throws(() => prompts.respond(1, { id: 'stale', confirmed: true }), /已失效/)
  assert.deepEqual(prompts.current(1), request)
  prompts.respond(1, { id: request.id, confirmed: false })
  assert.equal(await result, false)
  assert.equal(prompts.current(1), null)
  assert.equal(f.messages.at(-1), null)
  assert.throws(() => prompts.respond(1, { id: request.id, confirmed: true }), /已失效/)
})

test('关闭单窗升级为退出应用时撤销旧说明，必须确认新的退出请求', async () => {
  const prompts = new WindowClosePrompts()
  const f = fixture()
  const first = prompts.request(f.target, false)
  const previous = prompts.current(1)!
  const next = prompts.request(f.target, true)
  assert.equal(await first, false)
  const request = prompts.current(1)!
  assert.notEqual(previous.id, request.id)
  assert.equal(request.exiting, true)
  assert.throws(() => prompts.respond(1, { id: previous.id, confirmed: true }), /已失效/)
  prompts.respond(1, { id: request.id, confirmed: true })
  assert.equal(await next, true)
})

test('关闭、崩溃、重新加载和断连默认撤销退出，清理监听与界面就绪状态', async () => {
  for (const event of ['closed', 'render-process-gone', 'did-start-loading', 'disconnect']) {
    const prompts = new WindowClosePrompts()
    const f = fixture()
    prompts.connect(1)
    const result = prompts.request(f.target, true)
    if (event === 'closed') f.window.emit(event)
    else if (event !== 'disconnect') f.contents.emit(event)
    else prompts.disconnect(1)
    assert.equal(await result, false)
    assert.equal(prompts.current(1), null)
    assert.equal(f.window.listenerCount('closed'), 0)
    assert.equal(f.contents.listenerCount('render-process-gone'), 0)
    assert.equal(f.contents.listenerCount('did-start-loading'), 0)
    prompts.disconnect(1)
    assert.equal(prompts.isReady(1), false)
  }
})

test('退出确认只接受明确布尔选择，不接收额外窗口身份或跳过校验字段', () => {
  const id = '5fb99c6f-fdae-4434-8dfc-9232e024c2ab'
  assert.equal(windowCloseDecisionSchema.safeParse({ id, confirmed: false }).success, true)
  assert.equal(windowCloseDecisionSchema.safeParse({ id, confirmed: 'true' }).success, false)
  assert.equal(windowCloseDecisionSchema.safeParse({ id, confirmed: true, owner: 2 }).success, false)
})

test('消息投递失败保持软件打开，不留下未决确认', async () => {
  const prompts = new WindowClosePrompts()
  const f = fixture()
  f.contents.send = () => { throw new Error('renderer unavailable') }
  assert.equal(await prompts.request(f.target, true), false)
  assert.equal(prompts.current(1), null)
})
