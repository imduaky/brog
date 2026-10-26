/**
 * The window scrollbar appears only on pages that scroll. Its width is then taken out of
 * the page, so centred rows would move sideways between a short and a long page. While no
 * bar shows, this sets --sb-pad to the bar's width, which the `frame` rows use as padding.
 * Overlay scrollbars have zero width, so nothing changes for them.
 */
export function observeScrollbar(): () => void {
  const root = document.documentElement
  let width: number | null = null

  const measure = () => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;top:-9999px;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden'
    document.body.appendChild(probe)
    width = probe.offsetWidth - probe.clientWidth
    probe.remove()
  }

  const sync = () => {
    if (width === null) measure()
    const scrolls = root.scrollHeight > root.clientHeight
    root.style.setProperty('--sb-pad', scrolls ? '0px' : `${width ?? 0}px`)
  }

  const resize = new ResizeObserver(sync)
  resize.observe(document.body)
  window.addEventListener('resize', sync)
  sync()
  return () => {
    resize.disconnect()
    window.removeEventListener('resize', sync)
    root.style.removeProperty('--sb-pad')
  }
}
