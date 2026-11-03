import { useId } from 'react'
import type { ImageNode } from '@contracts/image-generation'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { imageRatios, imageSizeOptions, sizeForRatio, sizesForRatio } from './image-size-options'

export function ImageSizePicker({ value, disabled, onChange }: {
  value: ImageNode['size']; disabled: boolean; onChange: (value: ImageNode['size']) => void
}) {
  const id = useId()
  const selected = imageSizeOptions[value]
  return <div className="image-size-picker">
    <div className="image-size-choice"><label htmlFor={`${id}-ratio`}>画面比例</label>
      <SelectField id={`${id}-ratio`} aria-label="画面比例" disabled={disabled} value={selected.ratio} onChange={(event) => {
        const ratio = imageRatios.find((item) => item === event.target.value)
        if (ratio) onChange(sizeForRatio(value, ratio))
      }}>{imageRatios.map((ratio) => <SelectOption key={ratio} value={ratio}>{ratio}</SelectOption>)}</SelectField>
    </div>
    <div className="image-size-choice"><label htmlFor={`${id}-resolution`}>分辨率</label>
      <SelectField id={`${id}-resolution`} aria-label="图片分辨率" title={value} disabled={disabled} value={value} onChange={(event) => {
        const size = sizesForRatio(selected.ratio).find((item) => item === event.target.value)
        if (size) onChange(size)
      }}>{sizesForRatio(selected.ratio).map((size) => <SelectOption key={size} value={size}>{imageSizeOptions[size].tier}</SelectOption>)}</SelectField>
    </div>
    <span className="image-size-pixels" aria-live="polite">{value.replace('x', ' × ')} px</span>
  </div>
}
