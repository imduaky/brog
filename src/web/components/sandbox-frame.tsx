import { useEffect, useRef } from 'react'

/**
 * A custom HTML page in a sandboxed iframe: scripts run, but with an opaque origin,
 * so the page cannot read the site's cookies, DOM or API. It reports its own height.
 */
export function SandboxFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = ref.current
      if (!frame || e.source !== frame.contentWindow || (e.data as { type?: string })?.type !== 'brog-demo-height') return
      frame.style.height = `${Math.min(Math.max(Number(e.data.height) || 0, 120), 20000)}px`
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={html}
      className="motion-fade block min-h-[60svh] w-full rounded-lg border bg-background"
    />
  )
}
