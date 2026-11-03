import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

interface Option { value: string; label: ReactNode; disabled?: boolean }
const emptyValue = '__workbench_empty_selection__'

export function SelectOption(_props: { value?: string | number; disabled?: boolean; children?: ReactNode }) {
  return null
}

function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return []
    if (child.type === SelectOption || child.type === 'option') return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: child.props.disabled }]
    return optionsFrom(child.props.children)
  })
}

type SelectFieldProps = Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'defaultValue'> & {
  value: string
  onChange: (event: { target: { value: string } }) => void
  required?: boolean
}

// 筛选器与工具菜单共享同一 shadcn Select；空字符串选项映射为内部值，业务层仍接收原值。
export function SelectField({ children, value, onChange, disabled, name, required, ...props }: SelectFieldProps) {
  const options = optionsFrom(children)
  return <Select value={value || emptyValue} onValueChange={(next) => onChange({ target: { value: next === emptyValue ? '' : next } })} disabled={disabled} name={name} required={required}>
    <SelectTrigger {...props}><SelectValue placeholder="请选择" /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value || emptyValue} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}
