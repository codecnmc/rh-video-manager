import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { Dialog } from '@/components/ui/dialog'
import { InteractionHint } from '@/components/ui/interaction-hint'
import { CopyableAssetImage } from './CopyableAssetImage'

function PreviewImage({ assetId, name }: { assetId: string; name: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return <span className="asset-preview-image" data-state={state} aria-busy={state === 'loading'}>
    {state !== 'failed' && <CopyableAssetImage assetId={assetId} alt={name}
      onLoad={() => setState('ready')} onError={() => setState('failed')} />}
    {state === 'loading' && <span className="asset-preview-status" role="status" aria-label="正在加载图片"><FontAwesomeIcon icon={faSpinner} spin /></span>}
    {state === 'failed' && <span className="asset-preview-status" role="status" title="图片文件不可用" aria-label="图片文件不可用"><FontAwesomeIcon icon={faTriangleExclamation} /><span>图片不可用</span></span>}
  </span>
}

export function AssetImagePreview({ assetId, name, label }: { assetId: string; name: string; label: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="unstyled" type="button" className="reference-image-preview" title={`预览图片：${name}`} aria-label={`预览图片：${label} ${name}`} onClick={() => setOpen(true)}>
      <PreviewImage key={assetId} assetId={assetId} name={name} />
    </Button>
    {open && <Dialog title={`${label} · ${name}`} className="asset-image-preview-dialog" onClose={() => setOpen(false)}>
      <InteractionHint label="右键图片可复制"><p>右键图片可复制图片内容或素材库 ID，复制图片后可粘贴到支持图片的编辑器。</p></InteractionHint>
      <div className="asset-image-preview-stage"><PreviewImage key={assetId} assetId={assetId} name={name} /></div>
    </Dialog>}
  </>
}
