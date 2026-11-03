import type { PropsWithChildren } from 'react'
import { PopoverContent } from '@/components/ui/popover'

export function TaskQueuePopover({ children }: PropsWithChildren) {
  return <PopoverContent id="task-queue-popover" className="task-queue-popover" side="top" align="end" sideOffset={8} aria-label="任务队列浮窗">{children}</PopoverContent>
}
