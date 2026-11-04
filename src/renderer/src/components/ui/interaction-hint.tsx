import type { PropsWithChildren } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleQuestion } from '@fortawesome/free-solid-svg-icons'

export function InteractionHint({ label, children }: PropsWithChildren<{ label: string }>) {
  return <details className="interaction-hint"><summary><FontAwesomeIcon icon={faCircleQuestion} />{label}</summary><div>{children}</div></details>
}
