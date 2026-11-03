import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'danger' | 'unstyled'
  size?: 'default' | 'icon' | 'small'
}

export function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return <button data-slot="button" type={type} className={cn(variant !== 'unstyled' && ['button', `button-variant-${variant}`, `button-size-${size}`], className)} {...props} />
}
