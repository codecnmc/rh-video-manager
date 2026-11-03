import type { ComponentProps } from 'react'
import { TaskQueue } from './TaskQueue'
import './workbench-tasks.css'

export function WorkbenchTasks(props: ComponentProps<typeof TaskQueue>) {
  return <div className="workbench-tasks"><TaskQueue {...props} /></div>
}
