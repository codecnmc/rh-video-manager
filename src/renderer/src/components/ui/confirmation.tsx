import { useEffect, useState, useSyncExternalStore } from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { Button } from './button'

interface Confirmation { message: string; resolve: (confirmed: boolean) => void; save?: () => Promise<boolean>; information?: boolean }
const queue: Confirmation[] = []
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function confirmAction(message: string, save?: () => Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => { queue.push({ message, resolve, save }); notify() })
}

export function showMessage(message: string): Promise<void> {
  return new Promise((resolve) => { queue.push({ message, information: true, resolve: () => resolve() }); notify() })
}

function settle(confirmed: boolean) {
  const current = queue.shift()
  current?.resolve(confirmed)
  notify()
}

export function ConfirmationHost() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => queue[0])
  useEffect(() => { setError('') }, [current])
  useEffect(() => () => {
    // 宿主卸载时撤销尚未确认的操作，不把悬挂的确认请求当作授权。
    for (const item of queue.splice(0)) item.resolve(false)
  }, [])
  if (!current) return null
  return <AlertDialogPrimitive.Root open onOpenChange={(open) => { if (!open && !saving) settle(false) }}><AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="ui-dialog-overlay" />
    <AlertDialogPrimitive.Content className="dialog ui-confirmation">
      <AlertDialogPrimitive.Title asChild><h2>{current.information ? '操作提示' : '确认操作'}</h2></AlertDialogPrimitive.Title>
      <AlertDialogPrimitive.Description className="ui-confirmation-message">{current.message}</AlertDialogPrimitive.Description>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="dialog-actions">{!current.information && <Button variant="outline" disabled={saving} onClick={() => settle(false)}>取消</Button>}<Button disabled={saving} onClick={() => settle(true)}>{current.information ? '知道了' : current.save ? '放弃修改' : '确认'}</Button>
        {current.save && <Button disabled={saving} onClick={async () => {
          setSaving(true); setError('')
          try {
            if (await current.save?.()) settle(true)
            else setError('修改尚未全部保存，请检查任务内容或错误提示后重试。')
          } catch { setError('保存失败，修改已保留，请重试。') }
          finally { setSaving(false) }
        }}>{saving ? '保存中…' : '保存并切换'}</Button>}
      </div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPrimitive.Portal></AlertDialogPrimitive.Root>
}
