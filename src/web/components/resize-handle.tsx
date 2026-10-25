import { useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Vertical drag handle. `onDrag` receives horizontal pixel deltas, batched per
 * animation frame so a fast drag does not re-render on every pointer event.
 */
export function ResizeHandle({
  label,
  onDrag,
  onReset,
  onDragStateChange,
  className,
}: {
  label: string
  onDrag: (dx: number) => void
  onReset?: () => void
  onDragStateChange?: (dragging: boolean) => void
  className?: string
}) {
  const drag = useRef<{ last: number; pending: number; frame: number } | null>(null)

  const flush = () => {
    const d = drag.current
    if (!d) return
    d.frame = 0
    if (d.pending !== 0) {
      onDrag(d.pending)
      d.pending = 0
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label}（拖动，双击复原）`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { last: e.clientX, pending: 0, frame: 0 }
        document.body.style.cursor = 'col-resize'
        onDragStateChange?.(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.pending += e.clientX - d.last
        d.last = e.clientX
        if (!d.frame) d.frame = requestAnimationFrame(flush)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (d?.frame) cancelAnimationFrame(d.frame)
        flush()
        drag.current = null
        document.body.style.cursor = ''
        onDragStateChange?.(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onDrag(-16)
        if (e.key === 'ArrowRight') onDrag(16)
      }}
      className={cn(
        'group relative z-10 w-2 shrink-0 cursor-col-resize touch-none self-stretch outline-none focus-visible:bg-ring/30',
        className,
      )}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors duration-150 group-hover:bg-foreground/50 group-focus-visible:bg-foreground/50" />
    </div>
  )
}
