import { useEffect, useRef } from 'react'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.cm-editor'))
}

/** Calls `onMatch` when `sequence` is typed (outside inputs) within `windowMs`. */
export function useKeySequence(sequence: string, onMatch: () => void, windowMs = 1500) {
  const buffer = useRef<{ key: string; at: number }[]>([])
  const cb = useRef(onMatch)
  cb.current = onMatch

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.length !== 1) return
      const now = Date.now()
      buffer.current = [...buffer.current, { key: e.key.toLowerCase(), at: now }]
        .filter((k) => now - k.at <= windowMs)
        .slice(-sequence.length)
      if (buffer.current.map((k) => k.key).join('') === sequence) {
        // Cancel this keystroke: the callback may move focus into an input, and the same key
        // would otherwise be typed into it (leaving a stray "w" in the password field).
        e.preventDefault()
        buffer.current = []
        cb.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sequence, windowMs])
}
