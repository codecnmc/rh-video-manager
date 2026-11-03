import { Children, isValidElement, type PropsWithChildren, type ReactNode } from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { Button } from './button'

export function Disclosure({ children, className, open }: PropsWithChildren<{ className?: string; open?: boolean }>) {
  const items = Children.toArray(children)
  const summary = items.find((child) => isValidElement(child) && child.type === 'summary')
  const label = isValidElement<{ children?: ReactNode }>(summary) ? summary.props.children : '展开'
  return <CollapsiblePrimitive.Root data-slot="collapsible" className={className} defaultOpen={open}>
    <CollapsiblePrimitive.Trigger asChild><Button variant="unstyled" className="ui-disclosure-trigger">{label}</Button></CollapsiblePrimitive.Trigger>
    <CollapsiblePrimitive.Content>{items.filter((child) => child !== summary)}</CollapsiblePrimitive.Content>
  </CollapsiblePrimitive.Root>
}
