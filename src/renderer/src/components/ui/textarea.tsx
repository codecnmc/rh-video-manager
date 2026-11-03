import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/utils'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('ui-textarea', className)} {...props} />
}
