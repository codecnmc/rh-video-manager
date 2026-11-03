import type { ComponentProps } from 'react'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'
import { Input } from './input'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export function SuggestionInput({ options, onSelectValue, ...props }: ComponentProps<typeof Input> & { options: string[]; onSelectValue: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const query = String(props.value ?? '').trim().toLocaleLowerCase()
  const filtered = options.filter((option) => option.toLocaleLowerCase().includes(query))
  return <Popover open={open} onOpenChange={setOpen}><div className="ui-suggestion-input"><Input {...props} />
    <PopoverTrigger asChild><Button variant="ghost" size="icon" disabled={props.disabled || options.length === 0} title="选择已有内容" aria-label="选择已有内容"><FontAwesomeIcon icon={faChevronDown} /></Button></PopoverTrigger>
    <PopoverContent className="ui-suggestion-content" sideOffset={4} align="end">
      {filtered.map((option) => <Button key={option} variant="ghost" onClick={() => { onSelectValue(option); setOpen(false) }}>{option}</Button>)}
      {filtered.length === 0 && <span className="muted">无匹配项</span>}
    </PopoverContent>
  </div></Popover>
}
