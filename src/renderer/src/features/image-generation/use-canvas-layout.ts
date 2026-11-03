import { useEffect, useRef, useState } from 'react'
import type { ImageBoard } from '@contracts/image-generation'
import { canvasLayout, type CanvasLayout } from './canvas-model'
import type { ImageGenerationController } from './use-image-generation'

export function useCanvasLayout(board: ImageBoard, control: ImageGenerationController) {
  const [layout, setLayout] = useState(() => canvasLayout(board))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const failedSignature = useRef<string | null>(null)
  const current = useRef(layout)
  const revision = useRef(board.revision)
  const savedSignature = useRef(JSON.stringify(layout))
  const past = useRef<CanvasLayout[]>([])
  const future = useRef<CanvasLayout[]>([])
  const hasExternalChanges = dirty && !saving && board.revision > revision.current

  function update(next: CanvasLayout) {
    current.current = next
    setLayout(next)
    setDirty(JSON.stringify(next) !== savedSignature.current)
    setFailed(false)
    failedSignature.current = null
  }
  useEffect(() => {
    if (dirty || inFlight.current || board.revision < revision.current) return
    const next = canvasLayout(board)
    revision.current = board.revision
    savedSignature.current = JSON.stringify(next)
    current.current = next
    setLayout(next)
  }, [board, dirty])

  function change(transform: (previous: CanvasLayout) => CanvasLayout) {
    const next = transform(current.current)
    if (JSON.stringify(next) === JSON.stringify(current.current)) return
    past.current = [...past.current.slice(-49), current.current]
    future.current = []
    update(next)
  }
  function undo() {
    const previous = past.current.pop()
    if (!previous) return
    future.current.push(current.current)
    update(previous)
  }
  function redo() {
    const next = future.current.pop()
    if (!next) return
    past.current.push(current.current)
    update(next)
  }
  async function save() {
    if (inFlight.current || control.busy || hasExternalChanges) return
    const snapshot = current.current
    const signature = JSON.stringify(snapshot)
    inFlight.current = true
    setSaving(true)
    try {
      const saved = await control.saveLayout({ id: board.id, expectedRevision: revision.current, ...snapshot })
      if (!saved) { failedSignature.current = signature; setFailed(true); return }
      // 以开始编辑时的修订保存，不能用轮询得到的新修订覆盖另一客户端布局。
      revision.current = saved.revision
      savedSignature.current = JSON.stringify(canvasLayout(saved))
      failedSignature.current = null
      setFailed(false)
      setDirty(JSON.stringify(current.current) !== savedSignature.current)
    } finally { inFlight.current = false; setSaving(false) }
  }
  useEffect(() => {
    if (!dirty || saving || hasExternalChanges || control.busy || failedSignature.current === JSON.stringify(current.current)) return
    const timer = setTimeout(() => { void save() }, 700)
    return () => clearTimeout(timer)
  }, [layout, dirty, saving, hasExternalChanges, control.busy])
  function reload() {
    if (inFlight.current) return
    const next = canvasLayout(board)
    revision.current = board.revision
    savedSignature.current = JSON.stringify(next)
    past.current = []; future.current = []
    update(next)
  }
  return { layout, dirty, saving, failed, hasExternalChanges, reload, change, undo, redo, save, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}
