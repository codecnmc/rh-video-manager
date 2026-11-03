import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faMagnifyingGlass, faImages } from '@fortawesome/free-solid-svg-icons'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function ImageAssetPicker({ assets, referenceMode, selectedIds, onAdd, onClose }: {
  assets: Asset[]; referenceMode: boolean; selectedIds: string[]; onAdd: (assets: Asset[]) => void; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const filtered = assets.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase()))
  return <Dialog title={referenceMode ? '添加参考图片' : '添加图片到画布'} className="image-asset-picker" onClose={onClose}>
    <div className="image-generation-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><Input autoFocus aria-label="搜索图片素材" placeholder="搜索图片名称" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="image-asset-picker-grid">{filtered.map((asset) => {
      const alreadyAdded = referenceMode && selectedIds.includes(asset.id)
      const checked = selected.includes(asset.id)
      return <button key={asset.id} type="button" className="image-picker-item" aria-pressed={checked || alreadyAdded} disabled={alreadyAdded} title={asset.name}
        onClick={() => setSelected((previous) => checked ? previous.filter((id) => id !== asset.id) : [...previous, asset.id])}>
        <img src={`workbench-asset://library/${asset.id}`} alt="" loading="lazy" draggable={false} />
        {(checked || alreadyAdded) && <span className="image-picker-check"><FontAwesomeIcon icon={faCheck} /></span>}
        <span className="image-picker-name">{asset.name}</span>{asset.imageGeneration && <small>{asset.imageGeneration.accountName}</small>}
      </button>
    })}{!filtered.length && <div className="image-generation-empty"><FontAwesomeIcon icon={faImages} /><p>{search ? '没有匹配的图片' : '暂无可用图片'}</p></div>}</div>
    <div className="image-picker-footer"><span>{selected.length} 张已选{referenceMode ? ` · 已引用 ${selectedIds.length}/16` : ''}</span><div className="button-row"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!selected.length || referenceMode && selected.length + selectedIds.length > 16} onClick={() => onAdd(assets.filter((asset) => selected.includes(asset.id)))}>添加 {selected.length} 张</Button></div></div>
  </Dialog>
}
