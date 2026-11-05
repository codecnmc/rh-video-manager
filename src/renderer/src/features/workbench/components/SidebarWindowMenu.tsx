import type { ReactElement } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

export function SidebarWindowMenu({ children, onOpen, disabled = false }: {
  children: ReactElement; onOpen: () => void; disabled?: boolean
}) {
  return <ContextMenu><ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent><ContextMenuItem disabled={disabled} onSelect={onOpen}>
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} />在新窗口打开
    </ContextMenuItem></ContextMenuContent>
  </ContextMenu>
}
