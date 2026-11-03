import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { edgeScrollSpeed, intersectsSelection, marqueeSelection, selectionRect, type SelectionPoint, type SelectionRect } from './marquee-selection'

type Gesture = {
  pointerId: number; start: SelectionPoint; origin: SelectionPoint; pointer: SelectionPoint
  initial: string[]; toggle: boolean; active: boolean
  items: { id: string; rect: SelectionRect }[]
}

export function useLibraryMarquee({ selected, onSelect, disabled, contextKey }: {
  selected: string[]; onSelect: (ids: string[]) => void; disabled: boolean; contextKey: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ selected, onSelect })
  const cancelRef = useRef<(() => void) | null>(null)
  const cancel = useCallback(() => cancelRef.current?.(), [])
  const [rectangle, setRectangle] = useState<SelectionRect | null>(null)
  useLayoutEffect(() => { latest.current = { selected, onSelect } })

  useLayoutEffect(() => {
    const viewport = ref.current
    if (!viewport || disabled) return
    let gesture: Gesture | null = null
    let frame = 0
    let lastTime = 0
    let suppressClick = false
    let previousSelection = ''

    function bounds() {
      const rect = viewport!.getBoundingClientRect()
      return { left: rect.left + viewport!.clientLeft, top: rect.top + viewport!.clientTop }
    }
    function point(client: SelectionPoint): SelectionPoint {
      const rect = bounds()
      return {
        x: Math.max(0, Math.min(viewport!.clientWidth, client.x - rect.left)) + viewport!.scrollLeft,
        y: Math.max(0, Math.min(viewport!.clientHeight, client.y - rect.top)) + viewport!.scrollTop
      }
    }
    function update() {
      if (!gesture?.active) return
      const rect = selectionRect(gesture.start, point(gesture.pointer))
      setRectangle(rect)
      const hits = gesture.items.filter((item) => intersectsSelection(rect, item.rect)).map((item) => item.id)
      const next = marqueeSelection(gesture.initial, hits, gesture.toggle)
      const signature = JSON.stringify(next)
      if (signature !== previousSelection) { previousSelection = signature; latest.current.onSelect(next) }
    }
    function tick(time: number) {
      if (!gesture?.active) return
      const elapsed = Math.min(32, lastTime ? time - lastTime : 16) / 1000
      lastTime = time
      const rect = bounds()
      viewport!.scrollLeft += edgeScrollSpeed(gesture.pointer.x - rect.left, viewport!.clientWidth) * elapsed
      viewport!.scrollTop += edgeScrollSpeed(gesture.pointer.y - rect.top, viewport!.clientHeight) * elapsed
      update()
      frame = requestAnimationFrame(tick)
    }
    function finish() {
      const current = gesture
      gesture = null
      cancelAnimationFrame(frame)
      frame = 0; lastTime = 0
      setRectangle(null)
      viewport!.removeAttribute('data-marquee-active')
      if (current && viewport!.hasPointerCapture(current.pointerId)) viewport!.releasePointerCapture(current.pointerId)
    }
    function down(event: PointerEvent) {
      suppressClick = false
      if (event.button !== 0 || !event.isPrimary || event.pointerType !== 'mouse' || gesture) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || target.closest('[data-asset-id], [data-draggable-folder], button, input, a, select, textarea, [role="checkbox"], [contenteditable="true"], thead, .asset-browser-viewbar')) return
      const rect = bounds()
      // 原生滚动条仍由浏览器处理，不将其拖动识别成框选。
      if (event.clientX < rect.left || event.clientX >= rect.left + viewport!.clientWidth || event.clientY < rect.top || event.clientY >= rect.top + viewport!.clientHeight) return
      const initial = [...latest.current.selected]
      previousSelection = JSON.stringify(initial)
      gesture = {
        pointerId: event.pointerId, start: point({ x: event.clientX, y: event.clientY }),
        origin: { x: event.clientX, y: event.clientY }, pointer: { x: event.clientX, y: event.clientY },
        initial, toggle: event.ctrlKey || event.metaKey, active: false,
        items: Array.from(viewport!.querySelectorAll<HTMLElement>('[data-asset-id]')).map((item) => {
          const box = item.getBoundingClientRect()
          return { id: item.dataset.assetId!, rect: { left: box.left - rect.left + viewport!.scrollLeft, top: box.top - rect.top + viewport!.scrollTop, width: box.width, height: box.height } }
        })
      }
      event.preventDefault()
      viewport!.focus({ preventScroll: true })
      viewport!.setPointerCapture(event.pointerId)
    }
    function move(event: PointerEvent) {
      if (!gesture || event.pointerId !== gesture.pointerId) return
      gesture.pointer = { x: event.clientX, y: event.clientY }
      if (!gesture.active && Math.hypot(event.clientX - gesture.origin.x, event.clientY - gesture.origin.y) >= 4) {
        gesture.active = true
        suppressClick = true
        viewport!.setAttribute('data-marquee-active', 'true')
        frame = requestAnimationFrame(tick)
      }
      update()
    }
    function up(event: PointerEvent) {
      if (!gesture || event.pointerId !== gesture.pointerId) return
      move(event)
      if (!gesture.active && !gesture.toggle) latest.current.onSelect([])
      finish()
    }
    function cancel(event: PointerEvent) { if (event.pointerId === gesture?.pointerId) finish() }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') finish() }
    function click(event: MouseEvent) {
      if (suppressClick && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick = false }
    }
    cancelRef.current = finish
    viewport.addEventListener('pointerdown', down)
    viewport.addEventListener('pointermove', move)
    viewport.addEventListener('pointerup', up)
    viewport.addEventListener('pointercancel', cancel)
    viewport.addEventListener('lostpointercapture', cancel)
    viewport.addEventListener('click', click, true)
    viewport.addEventListener('scroll', update)
    viewport.addEventListener('contextmenu', finish)
    window.addEventListener('blur', finish)
    window.addEventListener('resize', finish)
    window.addEventListener('keydown', key)
    return () => {
      finish()
      cancelRef.current = null
      viewport.removeEventListener('pointerdown', down)
      viewport.removeEventListener('pointermove', move)
      viewport.removeEventListener('pointerup', up)
      viewport.removeEventListener('pointercancel', cancel)
      viewport.removeEventListener('lostpointercapture', cancel)
      viewport.removeEventListener('click', click, true)
      viewport.removeEventListener('scroll', update)
      viewport.removeEventListener('contextmenu', finish)
      window.removeEventListener('blur', finish)
      window.removeEventListener('resize', finish)
      window.removeEventListener('keydown', key)
    }
  }, [disabled, contextKey])

  return { ref, rectangle, cancel }
}
