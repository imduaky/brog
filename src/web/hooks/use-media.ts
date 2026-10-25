import { useSyncExternalStore } from 'react'

/** True while the media query matches. Re-renders when it flips. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
