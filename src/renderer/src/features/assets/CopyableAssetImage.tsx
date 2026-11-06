import type { ComponentProps } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy } from '@fortawesome/free-solid-svg-icons'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { useCopyAssetImage } from './use-copy-asset-image'

export function CopyableAssetImage({ assetId, disabled, onNotice, ...props }: ComponentProps<'img'> & {
  assetId: string; disabled?: boolean; onNotice?: (message: string) => void
}) {
  const clipboard = useCopyAssetImage(onNotice)
  return <ContextMenu><ContextMenuTrigger asChild>
    <img {...props} title={props.title ?? '右键可复制图片或素材库 ID'} src={`workbench-asset://library/${assetId}`} />
  </ContextMenuTrigger><ContextMenuContent onClick={(event) => event.stopPropagation()}>
    {/* Portal 内的点击仍会沿 React 树冒泡，需避免触发外层图片预览按钮；选中后保留菜单默认关闭行为。 */}
    <ContextMenuItem disabled={disabled || clipboard.busy} onSelect={() => { void clipboard.copy(assetId) }}>
      <FontAwesomeIcon icon={faCopy} />{clipboard.busy ? '正在复制…' : '复制图片'}
    </ContextMenuItem>
    <ContextMenuItem disabled={clipboard.busy} onSelect={() => { void clipboard.copy(assetId, 'id') }}>
      <FontAwesomeIcon icon={faCopy} />复制素材库 ID
    </ContextMenuItem>
    {clipboard.message && <ContextMenuItem disabled><span role="status">{clipboard.message}</span></ContextMenuItem>}
  </ContextMenuContent></ContextMenu>
}
