import type { ComponentProps } from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/shared/lib/utils'

export function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const bounded = value == null ? null : Math.min(100, Math.max(0, value))
  return <ProgressPrimitive.Root data-slot="progress" className={cn('ui-progress', className)} value={bounded} {...props}>
    <ProgressPrimitive.Indicator className="ui-progress-indicator" style={bounded === null ? undefined : { transform: `translateX(-${100 - bounded}%)` }} />
  </ProgressPrimitive.Root>
}
