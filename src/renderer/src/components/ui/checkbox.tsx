import type { ComponentProps } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck } from '@fortawesome/free-solid-svg-icons'
import { cn } from '@/shared/lib/utils'

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn('ui-checkbox', className)} {...props}>
    <CheckboxPrimitive.Indicator><FontAwesomeIcon icon={faCheck} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
}
