import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileLines, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import type { Asset } from '@contracts/assets'

export function AssetMedia({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const [failed, setFailed] = useState(false)
  const url = `workbench-asset://library/${asset.id}`
  if (failed) return <div className="asset-media-empty"><FontAwesomeIcon icon={faTriangleExclamation} /><span>文件不可用</span></div>
  if (asset.kind === 'image') return <img src={url} alt={asset.name} loading="lazy" onError={() => setFailed(true)} />
  if (asset.kind === 'video') return <video src={url} controls={!compact} muted={compact} playsInline preload="metadata" onError={() => setFailed(true)} />
  if (asset.kind === 'audio') return <div className="asset-audio"><audio src={url} controls preload="metadata" onError={() => setFailed(true)} /></div>
  return <div className="asset-prompt-preview"><FontAwesomeIcon icon={faFileLines} /><p>{asset.prompt}</p></div>
}
