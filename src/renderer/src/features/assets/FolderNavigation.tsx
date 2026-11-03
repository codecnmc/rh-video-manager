import { Button } from '@/components/ui/button'
import { useState, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faChevronDown, faFolder, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
import type { AssetCategory } from '@contracts/assets'
import { folderPath, isWithinFolder } from './folders'

export function FolderNavigation({ categories, selected, onSelect, dropTarget, busy }: {
  categories: AssetCategory[]; selected: string; onSelect: (id: string) => void
  dropTarget: string | null; busy: boolean
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  function branch(parentId: string | null): ReactNode {
    return <ul>{categories.filter((item) => item.parentId === parentId).map((folder) => {
      const hasChildren = categories.some((item) => item.parentId === folder.id)
      const open = !collapsed.has(folder.id)
      return <li key={folder.id}><div className="asset-folder-row">
        <Button variant="unstyled" type="button" className="asset-folder-toggle" aria-label={`${open ? '收起' : '展开'} ${folder.name}`} aria-expanded={hasChildren ? open : undefined}
          disabled={!hasChildren} onClick={() => setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id)
            return next
          })}><FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} /></Button>
        <Button variant="unstyled" type="button" draggable={!busy} data-draggable-folder={folder.id} data-folder-id={folder.id} data-drop-active={dropTarget === folder.id} className={selected === folder.id ? 'active' : ''} aria-current={selected === folder.id ? 'page' : undefined}
          title={folderPath(categories, folder.id)} onClick={() => onSelect(folder.id)}>
          <FontAwesomeIcon icon={isWithinFolder(categories, selected, folder.id) ? faFolderOpen : faFolder} /><span>{folder.name}</span></Button>
      </div>{hasChildren && open && branch(folder.id)}</li>
    })}</ul>
  }
  return <nav className="asset-folder-navigation" aria-label="素材文件夹">
    <Button variant="unstyled" type="button" className={selected === 'all' ? 'active' : ''} onClick={() => onSelect('all')}>全部素材</Button>
    <Button variant="unstyled" type="button" data-folder-id="none" data-drop-active={dropTarget === 'none'} className={selected === 'none' ? 'active' : ''} onClick={() => onSelect('none')}><FontAwesomeIcon icon={faFolderOpen} />根目录</Button>
    {branch(null)}
  </nav>
}
