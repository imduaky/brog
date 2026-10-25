import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'brog-theme'

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {}
  return 'system'
}

const media = matchMedia('(prefers-color-scheme: dark)')
let theme: Theme = readStored()
let snapshot = { theme, resolved: resolve(theme) }
const listeners = new Set<() => void>()

function resolve(t: Theme): 'light' | 'dark' {
  return t === 'dark' || (t === 'system' && media.matches) ? 'dark' : 'light'
}

function update() {
  snapshot = { theme, resolved: resolve(theme) }
  document.documentElement.classList.toggle('dark', snapshot.resolved === 'dark')
  for (const l of listeners) l()
}

media.addEventListener('change', update)
update()

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {}
  theme = t
  update()
}

export function useTheme() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
  return { ...s, setTheme }
}
