export function assemblyShortcut(event: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean
  repeat?: boolean
}): 'undo' | 'redo' | 'save' | 'split' | 'delete' | 'play' | 'backward' | 'forward' | null {
  if (event.isComposing || event.altKey) return null
  const key = event.key.toLowerCase()
  if (event.repeat && (event.ctrlKey || event.metaKey || event.shiftKey || key !== 'arrowleft' && key !== 'arrowright')) return null
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !event.shiftKey) return 'redo'
    if (key === 's' && !event.shiftKey) return 'save'
    if (key === 'b' && !event.shiftKey) return 'split'
  } else if (!event.shiftKey) {
    if (key === 'delete') return 'delete'
    if (key === ' ') return 'play'
    if (key === 'arrowleft') return 'backward'
    if (key === 'arrowright') return 'forward'
  }
  return null
}
