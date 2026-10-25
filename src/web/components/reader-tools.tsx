import { ArrowUp, ChevronDown, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prefersReducedMotion } from '@/hooks/use-media'
import { cn } from '@/lib/utils'

export interface ToolItem {
  key: string
  label: string
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
}

/**
 * Floating function area in the bottom-right corner of the reader. It can be
 * minimized to a single square button and expanded again.
 */
export function ReaderTools({
  minimized,
  onMinimizedChange,
  tools,
}: {
  minimized: boolean
  onMinimizedChange: (v: boolean) => void
  tools: ToolItem[]
}) {
  const toTop = () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })

  if (minimized) {
    return (
      <div className="fixed right-4 bottom-4 z-40">
        <Button
          variant="outline"
          size="icon"
          className="motion-pop bg-background shadow-md"
          onClick={() => onMinimizedChange(false)}
          aria-label="展开功能区"
          title="展开功能区"
        >
          <PanelRight />
        </Button>
      </div>
    )
  }

  return (
    <div className="motion-pop fixed right-4 bottom-4 z-40 flex flex-col overflow-hidden rounded-lg border bg-background shadow-md">
      <div className="flex items-center gap-1 border-b py-0.5 pr-0.5 pl-2 text-xs text-muted-foreground">
        功能
        <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => onMinimizedChange(true)} aria-label="缩小功能区">
          <ChevronDown />
        </Button>
      </div>
      <div className="flex flex-col p-1">
        <ToolButton label="回到顶部" icon={<ArrowUp />} onClick={toTop} />
        {tools.map((t) => (
          <ToolButton key={t.key} label={t.label} icon={t.icon} active={t.active} onClick={t.onClick} />
        ))}
      </div>
    </div>
  )
}

function ToolButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'clickable flex h-8 w-28 items-center gap-2 px-2 text-sm [&_svg]:size-4',
        active && 'bg-accent font-medium text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

