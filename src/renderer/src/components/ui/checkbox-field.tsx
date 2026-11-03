import type { ComponentProps } from 'react'
import { Checkbox } from './checkbox'

type CheckboxFieldProps = Omit<ComponentProps<typeof Checkbox>, 'onChange' | 'onCheckedChange'> & {
  onChange?: (event: { target: { checked: boolean } }) => void
}

export function CheckboxField({ onChange, ...props }: CheckboxFieldProps) {
  return <Checkbox {...props} onCheckedChange={(checked) => onChange?.({ target: { checked: checked === true } })} />
}
