import { useEffect, useState } from 'react'

/** Hide the header after this much downward travel; reveal it on any upward movement. */
const HIDE_AFTER = 80
const MIN_DELTA = 4

/**
 * Tracks scroll direction. Returns true while the header should be hidden.
 * Keeps `--header-h` on the root in sync, so sticky panels follow the header.
 */
export function useHeaderAutoHide(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (!enabled) {
      setHidden(false)
      root.style.setProperty('--header-h', '3.5rem')
      return
    }
    let last = window.scrollY
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      const delta = y - last
      last = y
      if (y <= 8) setHidden(false)
      else if (Math.abs(delta) >= MIN_DELTA) setHidden(delta > 0 && y > HIDE_AFTER)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [enabled])

  useEffect(() => {
    document.documentElement.style.setProperty('--header-h', hidden ? '0px' : '3.5rem')
  }, [hidden])

  return hidden
}
