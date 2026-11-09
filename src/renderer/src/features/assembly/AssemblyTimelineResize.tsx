import { useRef } from 'react'

export function AssemblyTimelineResize({ height, onResize }: { height: number; onResize: (height: number) => void }) {
  const drag = useRef<{ y: number; height: number; maximum: number } | null>(null)
  return <div className="assembly-timeline-resize" role="separator" tabIndex={0} aria-label="调整时间轴高度" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={520} aria-valuenow={height}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault(); event.stopPropagation()
      const maximum = Math.max(180, Math.min(520, (event.currentTarget.parentElement?.clientHeight ?? 900) - 380))
      onResize(Math.min(maximum, Math.max(180, height + (event.key === 'ArrowUp' ? 20 : -20))))
    }} onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { y: event.clientY, height: event.currentTarget.nextElementSibling?.clientHeight ?? height, maximum: Math.max(180, Math.min(520, (event.currentTarget.parentElement?.clientHeight ?? 900) - 380)) }
    }} onPointerMove={(event) => {
      const active = drag.current
      if (active) onResize(Math.max(180, Math.min(active.maximum, active.height + active.y - event.clientY)))
    }} onPointerUp={(event) => {
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }} onPointerCancel={(event) => {
      if (drag.current) onResize(drag.current.height)
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }} />
}
