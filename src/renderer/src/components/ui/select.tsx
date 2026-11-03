import type { ComponentProps } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons'
import { cn } from '@/shared/lib/utils'

export const Select = SelectPrimitive.Root
export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn('ui-select-trigger', className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><FontAwesomeIcon icon={faChevronDown} /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

export function SelectContent({ className, children, position = 'popper', ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={4} className={cn('ui-select-content', className)} {...props}>
    <SelectPrimitive.ScrollUpButton className="ui-select-scroll"><FontAwesomeIcon icon={faChevronUp} /></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="ui-select-scroll"><FontAwesomeIcon icon={faChevronDown} /></SelectPrimitive.ScrollDownButton>
  </SelectPrimitive.Content></SelectPrimitive.Portal>
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn('ui-select-item', className)} {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="ui-select-indicator"><FontAwesomeIcon icon={faCheck} /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
}
