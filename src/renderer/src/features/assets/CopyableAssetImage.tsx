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
    <img {...props} src={`workbench-asset://library/${assetId}`} />
  </ContextMenuTrigger><ContextMenuContent>
    <ContextMenuItem disabled={disabled || clipboard.busy} onSelect={(event) => { event.preventDefault(); void clipboard.copy(assetId) }}>
      <FontAwesomeIcon icon={faCopy} />{clipboard.busy ? '正在复制…' : '复制图片'}
    </ContextMenuItem>
    <ContextMenuItem disabled={clipboard.busy} onSelect={(event) => { event.preventDefault(); void clipboard.copy(assetId, 'id') }}>
      <FontAwesomeIcon icon={faCopy} />复制素材库 ID
    </ContextMenuItem>
    {clipboard.message && <ContextMenuItem disabled><span role="status">{clipboard.message}</span></ContextMenuItem>}
  </ContextMenuContent></ContextMenu>
}
