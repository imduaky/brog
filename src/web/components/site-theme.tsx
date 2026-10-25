import type { SiteSettings } from '@shared/types'
import { textOn } from '@shared/color'
import { useLayoutEffect } from 'react'
import { useTheme } from '@/hooks/use-theme'

/**
 * Applies the paper color of the current mode to the page. Every token that
 * mixes from --background and --foreground follows.
 */
export function SiteThemeSync({ settings }: { settings?: SiteSettings }) {
  const { resolved } = useTheme()
  const paper = settings?.paper[resolved]
  useLayoutEffect(() => {
    if (!paper) return
    const style = document.documentElement.style
    style.setProperty('--background', paper)
    style.setProperty('--foreground', textOn(paper))
  }, [paper])
  return null
}
