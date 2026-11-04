import { useEffect, useId, useRef, useState, type PropsWithChildren } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'

export function AnchoredGuide({ target, children, onDismiss }: PropsWithChildren<{ target: HTMLElement | null; onDismiss: () => void }>) {
  const panel = useRef<HTMLElement>(null)
  const targetId = useId()
  const [ownedTarget, setOwnedTarget] = useState<string>()
  const [spotlight, setSpotlight] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    const element = panel.current
    setPosition(null)
    setSpotlight(null)
    setOwnedTarget(undefined)
    if (!target || !element) return
    let active = true
    const previousId = target.getAttribute('id')
    if (!previousId) target.id = targetId
    setOwnedTarget(target.id)
    const previousDescription = target.getAttribute('aria-describedby')
    target.classList.add('guide-target')
    target.setAttribute('aria-describedby', [previousDescription, 'first-use-guide-description'].filter(Boolean).join(' '))
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    target.focus({ preventScroll: true })
    // 从目标入口按 Tab 可直接进入引导，不必遍历整页才能找到下一步。
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === target && !event.defaultPrevented) {
        event.preventDefault(); dismissRef.current(); return
      }
      if (event.key !== 'Tab' || event.shiftKey || event.target !== target) return
      const next = element.querySelector<HTMLButtonElement>('[data-guide-next]:not(:disabled)')
      if (next) { event.preventDefault(); next.focus() }
    }
    target.addEventListener('keydown', keydown)
    const update = () => {
      const bounds = target.getBoundingClientRect()
      setSpotlight({ left: Math.max(0, Math.min(window.innerWidth, bounds.left - 6)),
        top: Math.max(0, Math.min(window.innerHeight, bounds.top - 6)),
        right: Math.max(0, Math.min(window.innerWidth, bounds.right + 6)),
        bottom: Math.max(0, Math.min(window.innerHeight, bounds.bottom + 6)) })
      void computePosition(target, element, { strategy: 'fixed', placement: 'right-start',
        middleware: [offset(16), flip(), shift({ padding: 12 })] }).then(({ x, y }) => {
        if (active) setPosition({ left: x, top: y })
      })
    }
    const cleanup = autoUpdate(target, element, update)
    return () => {
      active = false
      cleanup()
      target.classList.remove('guide-target')
      if (previousId === null) target.removeAttribute('id')
      else target.setAttribute('id', previousId)
      target.removeEventListener('keydown', keydown)
      if (previousDescription === null) target.removeAttribute('aria-describedby')
      else target.setAttribute('aria-describedby', previousDescription)
    }
  }, [target, targetId])
  useEffect(() => {
    const element = panel.current
    if (!element) return
    // 让更高层的编辑/确认弹窗接管焦点，不能与 Radix 的模态焦点约束竞争。
    const hasHigherModal = () => Boolean(document.querySelector('.ui-dialog-overlay, dialog[open]'))
    const controls = () => [target, ...element.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]')]
      .filter((item): item is HTMLElement => Boolean(item?.isConnected && item.getClientRects().length && !item.matches(':disabled')))
    const focusin = (event: FocusEvent) => {
      if (hasHigherModal() || !(event.target instanceof Node) || element.contains(event.target) || target?.contains(event.target)) return
      const destination = controls()[0] ?? element
      destination.focus({ preventScroll: true })
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || hasHigherModal()) return
      const items = controls()
      const index = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
      const next = items.length ? items[index < 0 ? (event.shiftKey ? items.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length] : element
      event.preventDefault()
      next?.focus({ preventScroll: true })
    }
    const wheel = (event: WheelEvent) => {
      if (!hasHigherModal() && event.target instanceof Node && !element.contains(event.target)) event.preventDefault()
    }
    document.addEventListener('focusin', focusin)
    document.addEventListener('keydown', keydown)
    document.addEventListener('wheel', wheel, { passive: false })
    if (!target && !hasHigherModal()) element.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('focusin', focusin)
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('wheel', wheel)
    }
  }, [target])
  return createPortal(<div role="dialog" aria-modal="true" aria-label="首次使用引导" aria-owns={ownedTarget}>
    <div className="guide-backdrop" aria-hidden="true" onPointerDown={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}>
      {spotlight ? <>
        <div className="guide-backdrop-block" style={{ top: 0, left: 0, right: 0, height: spotlight.top }} />
        <div className="guide-backdrop-block" style={{ top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.bottom - spotlight.top }} />
        <div className="guide-backdrop-block" style={{ top: spotlight.top, left: spotlight.right, right: 0, height: spotlight.bottom - spotlight.top }} />
        <div className="guide-backdrop-block" style={{ top: spotlight.bottom, bottom: 0, left: 0, right: 0 }} />
        <div className="guide-spotlight" style={{ left: spotlight.left, top: spotlight.top, width: spotlight.right - spotlight.left, height: spotlight.bottom - spotlight.top }} />
      </> : <div className="guide-backdrop-block" style={{ inset: 0 }} />}
    </div>
    <aside ref={panel} className="anchored-guide" tabIndex={-1} aria-label="引导步骤"
    onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onDismiss() } }}
    style={target ? { left: position?.left ?? 12, top: position?.top ?? 12, visibility: position ? 'visible' : 'hidden' } : { right: 20, bottom: 20 }}>
    {children}
  </aside></div>, document.body)
}
