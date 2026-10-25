import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/hooks/use-theme'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'

const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

const DETAILS_MS = 220
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Rendered mermaid SVG by theme + source, so re-renders of the same diagram do not flash. */
const mermaidCache = new Map<string, string>()
let mermaidId = 0

const running = new WeakMap<HTMLDetailsElement, Animation>()
const intent = new WeakMap<HTMLDetailsElement, boolean>()

/**
 * Opens or closes a collapsible block. The body animates its height and opacity.
 * The `open` attribute changes only after the animation ends, so a closing block
 * never shows a leftover strip or disappears in one frame. A click during the
 * animation reverses it from the height it has reached.
 */
function toggleDetails(details: HTMLDetailsElement) {
  const body = details.querySelector<HTMLElement>(':scope > .details-body')
  const wantOpen = !(intent.get(details) ?? details.open)
  intent.set(details, wantOpen)
  if (!body || reduceMotion()) {
    details.open = wantOpen
    intent.delete(details)
    return
  }
  const animating = running.get(details)
  // A block that is closed and not animating has no visible height, so the animation starts at 0.
  const from = animating || details.open ? body.getBoundingClientRect().height : 0
  animating?.cancel()
  if (wantOpen) details.open = true
  const to = wantOpen ? body.scrollHeight : 0
  const anim = body.animate(
    [
      { height: `${from}px`, opacity: wantOpen ? 0.4 : 1 },
      { height: `${to}px`, opacity: wantOpen ? 1 : 0 },
    ],
    { duration: DETAILS_MS, easing: EASE, fill: 'forwards' },
  )
  running.set(details, anim)
  anim.onfinish = () => {
    details.open = wantOpen
    // Cancel only after the attribute is set, so there is no frame at the old height.
    anim.cancel()
    running.delete(details)
    intent.delete(details)
  }
}

/** Server-rendered (and sanitized) article HTML plus client enhancements. */
export function MarkdownView({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  // A separately deployed frontend loads images from the API origin.
  const finalHtml = useMemo(() => (API_BASE ? html.replace(/(<img[^>]*\ssrc=")\//g, `$1${API_BASE}/`) : html), [html])

  // Layout effects run before paint, so the enhanced DOM replaces the raw one without a flash.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    for (const block of root.querySelectorAll<HTMLElement>('.code-block')) {
      if (block.querySelector('.copy-code')) continue
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'copy-code'
      btn.title = '复制'
      btn.setAttribute('aria-label', '复制代码')
      btn.innerHTML = COPY_ICON
      btn.onclick = () => {
        const code = block.querySelector('pre')?.innerText ?? ''
        void navigator.clipboard.writeText(code).then(() => {
          btn.textContent = '✓'
          setTimeout(() => (btn.innerHTML = COPY_ICON), 1200)
        })
      }
      block.append(btn)
    }
  }, [finalHtml])

  // Collapsible blocks animate; the native toggle is cancelled.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const summary = (e.target as Element | null)?.closest?.('details > summary')
      if (!summary || !root.contains(summary)) return
      e.preventDefault()
      toggleDetails(summary.parentElement as HTMLDetailsElement)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  // Mermaid: cached SVG is applied synchronously; new diagrams render once mermaid is loaded.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const pending: { node: HTMLElement; source: string }[] = []
    for (const node of root.querySelectorAll<HTMLElement>('pre.mermaid')) {
      node.dataset.source ??= node.textContent ?? ''
      const source = node.dataset.source
      const svg = mermaidCache.get(`${resolved}\0${source}`)
      if (svg) node.innerHTML = svg
      else {
        node.classList.add('pending')
        pending.push({ node, source })
      }
    }
    if (!pending.length) return
    let cancelled = false
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: resolved === 'dark' ? 'dark' : 'default', securityLevel: 'strict' })
      for (const { node, source } of pending) {
        try {
          const { svg } = await mermaid.render(`mermaid-${++mermaidId}`, source)
          mermaidCache.set(`${resolved}\0${source}`, svg)
          if (!cancelled) node.innerHTML = svg
        } catch (err) {
          if (!cancelled) node.textContent = `${source}\n\n${String(err)}`
        } finally {
          node.classList.remove('pending')
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [finalHtml, resolved])

  // Live demo iframes report their content height.
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type !== 'brog-demo-height') return
      for (const frame of ref.current?.querySelectorAll<HTMLIFrameElement>('iframe.live-demo-frame') ?? []) {
        if (frame.contentWindow === e.source) {
          frame.style.height = `${Math.min(Math.max(Number(e.data.height) || 0, 40), 2000)}px`
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return <div ref={ref} className={cn('markdown', className)} dangerouslySetInnerHTML={{ __html: finalHtml }} />
}
