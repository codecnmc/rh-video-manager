import { useEffect, useRef, useState } from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { WindowClosePrompt } from '@contracts/window-close'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'

export function WindowCloseConfirmation() {
  const [prompt, setPrompt] = useState<WindowClosePrompt | null>(null)
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState('')
  const actions = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!window.workbench) return
    let active = true, received = false
    const unsubscribe = desktop().onWindowClosePrompt((next) => { received = true; setPrompt(next) })
    // 先订阅再回读，处理窗口首次载入与关闭请求交错，旧回读不能覆盖新事件。
    void desktop().currentWindowClosePrompt().then(unwrap).then((current) => {
      if (active && !received) setPrompt(current)
    }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => { setError(''); setResponding(false) }, [prompt?.id])
  async function respond(confirmed: boolean) {
    if (!prompt || responding) return
    setResponding(true); setError('')
    try { unwrap(await desktop().respondWindowClosePrompt({ id: prompt.id, confirmed })) }
    catch { setError('未能完成退出确认，请重试。'); setResponding(false) }
  }
  if (!prompt) return null
  return <AlertDialogPrimitive.Root open onOpenChange={(open) => { if (!open) void respond(false) }}><AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="ui-dialog-overlay window-close-overlay" />
    <AlertDialogPrimitive.Content className="dialog window-close-confirmation" onOpenAutoFocus={(event) => {
      event.preventDefault(); actions.current?.querySelector<HTMLButtonElement>('[data-close-cancel]')?.focus()
    }} onEscapeKeyDown={(event) => { if (responding) event.preventDefault() }}>
      <div className="dialog-heading"><div className="window-close-heading"><FontAwesomeIcon icon={faTriangleExclamation} />
        <AlertDialogPrimitive.Title asChild><h2>仍有任务未结束</h2></AlertDialogPrimitive.Title>
      </div><Button variant="ghost" size="icon" title="继续等待" aria-label="取消关闭，继续等待" disabled={responding} onClick={() => void respond(false)}><FontAwesomeIcon icon={faXmark} /></Button></div>
      <AlertDialogPrimitive.Description className="window-close-description">{prompt.exiting
        ? '现在退出将中断本地上传、下载和任务监听。'
        : '关闭此窗口后，其他窗口与后台任务仍会继续。'}</AlertDialogPrimitive.Description>
      {prompt.preview && <p className="muted">调试预览：点击确认不会关闭窗口或退出应用。</p>}
      <div className="window-close-warning"><strong>关闭软件不等于取消远端任务</strong>
        <p>{prompt.exiting ? '远端任务可能仍在运行或已计费。重新打开后请核对状态，不会自动重新提交生成。' : '远端任务不会因为关闭这个窗口而取消，可能仍在运行或已计费。'}</p>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions" ref={actions}><Button variant="danger" disabled={responding} onClick={() => void respond(true)}>{prompt.exiting ? '仍然退出' : '关闭此窗口'}</Button>
        <Button data-close-cancel disabled={responding} onClick={() => void respond(false)}>继续等待</Button></div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPrimitive.Portal></AlertDialogPrimitive.Root>
}
