import { ArrowUp, ChevronDown, PanelRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { prefersReducedMotion } from '@/hooks/use-media'
import { cn } from '@/lib/utils'

export type ToolItem = {
  key: string
  label: string
  icon: React.ReactNode
  active?: boolean
} & ({ onClick: () => void } | { to: string })

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
      {/* The whole title bar is the minimize control, not just the arrow at its end. */}
      <button
        type="button"
        onClick={() => onMinimizedChange(true)}
        aria-label="缩小功能区"
        title="缩小功能区"
        className="flex h-7 w-full items-center gap-1 border-b pr-1.5 pl-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
      >
        功能
        <ChevronDown className="ml-auto size-3.5" />
      </button>
      <div className="flex flex-col p-1">
        <ToolButton tool={{ key: 'top', label: '回到顶部', icon: <ArrowUp />, onClick: toTop }} />
        {tools.map((t) => (
          <ToolButton key={t.key} tool={t} />
        ))}
      </div>
    </div>
  )
}

const TOOL = 'clickable flex h-8 w-28 items-center gap-2 px-2 text-sm [&_svg]:size-4'

function ToolButton({ tool }: { tool: ToolItem }) {
  if ('to' in tool) {
    return (
      <Link to={tool.to} className={TOOL}>
        {tool.icon}
        {tool.label}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={tool.onClick}
      aria-pressed={tool.active}
      className={cn(TOOL, tool.active && 'bg-accent font-medium text-foreground')}
    >
      {tool.icon}
      {tool.label}
    </button>
  )
}

