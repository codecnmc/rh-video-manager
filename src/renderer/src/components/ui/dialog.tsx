import type { PropsWithChildren } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { Button } from './button'

interface DialogProps extends PropsWithChildren { title: string; onClose: () => void; className?: string }

export function Dialog({ title, onClose, children, className = '' }: DialogProps) {
  return <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-dialog-overlay" />
    <DialogPrimitive.Content className={`dialog ${className}`} aria-describedby={undefined} onSubmit={(event) => event.stopPropagation()}>
    <div className="dialog-heading"><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
      <Button variant="ghost" size="icon" title="关闭" aria-label="关闭" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></Button>
    </div>
    {children}
  </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
