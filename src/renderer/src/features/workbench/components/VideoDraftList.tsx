import { useEffect, useRef } from 'react'
import Sortable from 'sortablejs'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUp, faArrowDown, faCopy, faTrash, faCheck } from '@fortawesome/free-solid-svg-icons'
import type { VideoDraft } from '@contracts/video'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'

interface VideoDraftListProps {
  drafts: VideoDraft[]
  activeId?: string
  selectedIds: string[]
  busy: boolean
  editable: boolean
  sortable: boolean
  emptyMessage: string
  onSelect: (id: string) => void
  onToggleSelection: (id: string) => void
  onCopy: (id: string) => void
  onRemove: (draft: VideoDraft) => void
  onReorder: (ids: string[]) => void
}

export function VideoDraftList(props: VideoDraftListProps) {
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const suppressClickUntil = useRef(0)
  const disabled = !props.sortable
  useEffect(() => {
    if (!list.current) return
    let initialIds: string[] = []
    const sortable = Sortable.create(list.current, {
      animation: 150,
      disabled,
      draggable: '.video-draft-row',
      filter: 'input',
      preventOnFilter: false,
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      ghostClass: 'video-draft-ghost',
      chosenClass: 'video-draft-chosen',
      onStart: () => {
        initialIds = latest.current.drafts.map((draft) => draft.id)
        suppressClickUntil.current = Infinity
      },
      onEnd: (event) => {
        suppressClickUntil.current = Date.now() + 250
        const { oldIndex, newIndex, item, from } = event
        // SortableJS 改过的 DOM 先恢复，再由 React 按持久化结果更新，避免节点与虚拟 DOM 错位。
        const siblings = Array.from(from.children).filter((child) => child !== item)
        if (oldIndex !== undefined) from.insertBefore(item, siblings[oldIndex] ?? null)
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
        const ids = latest.current.drafts.map((draft) => draft.id)
        // 拖动期间 MCP 或其他操作改变了列表时，不用旧下标重排新数据。
        if (ids.length !== initialIds.length || ids.some((id, index) => id !== initialIds[index])) return
        const moved = ids.splice(oldIndex, 1)[0]
        if (!moved) return
        ids.splice(newIndex, 0, moved)
        latest.current.onReorder(ids)
      }
    })
    return () => { sortable.destroy(); suppressClickUntil.current = Date.now() + 250 }
  }, [disabled])

  function move(index: number, offset: number) {
    const ids = props.drafts.map((draft) => draft.id)
    const moved = ids.splice(index, 1)[0]
    if (!moved) return
    ids.splice(index + offset, 0, moved)
    props.onReorder(ids)
  }

  return <div className="shot-items video-draft-items" ref={list}>
    {props.drafts.map((draft, index) => <ContextMenu key={draft.id}>
      <ContextMenuTrigger asChild><div className={`video-draft-row ${props.activeId === draft.id ? 'selected' : ''}`}>
        {props.selectedIds.length > 0 && <input type="checkbox" aria-label={`选择草稿：${draft.title}`} checked={props.selectedIds.includes(draft.id)} disabled={props.busy} onChange={() => props.onToggleSelection(draft.id)} />}
        <Button variant="unstyled" className="video-draft-item" aria-pressed={props.activeId === draft.id} disabled={props.busy}
          onClick={() => { if (Date.now() >= suppressClickUntil.current) props.onSelect(draft.id) }}>
          <span className="video-draft-heading"><strong>{draft.title}</strong><span className="video-draft-duration">{draft.duration} 秒</span></span>
          <span className="video-draft-metadata">
            <span>{draft.aspectRatio}</span><span>{draft.resolution}</span>
            <span title="已保存的运行档位">{{ default: 'Lite', plus: 'Plus', ultra: 'Ultra' }[draft.instance]}{draft.instanceMode === 'auto' ? '（自动）' : ''}</span>
          </span>
        </Button>
      </div></ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!props.editable} onSelect={() => props.onCopy(draft.id)}><FontAwesomeIcon icon={faCopy} />复制草稿</ContextMenuItem>
        <ContextMenuItem disabled={props.busy} onSelect={() => props.onToggleSelection(draft.id)}><FontAwesomeIcon icon={faCheck} />{props.selectedIds.includes(draft.id) ? '取消选择' : '选择草稿'}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!props.sortable || index === 0} onSelect={() => move(index, -1)}><FontAwesomeIcon icon={faArrowUp} />上移</ContextMenuItem>
        <ContextMenuItem disabled={!props.sortable || index === props.drafts.length - 1} onSelect={() => move(index, 1)}><FontAwesomeIcon icon={faArrowDown} />下移</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={props.busy} className="danger" onSelect={() => props.onRemove(draft)}><FontAwesomeIcon icon={faTrash} />删除草稿</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>)}
    {!props.drafts.length && <div className="queue-empty">{props.emptyMessage}</div>}
  </div>
}
