import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** Header of a reader side panel. The hide switch sits above the panel content. */
export function PanelHeader({
  title,
  side,
  onHide,
  actions,
}: {
  title: string
  side: 'left' | 'right'
  onHide: () => void
  actions?: ReactNode
}) {
  const Icon = side === 'left' ? PanelLeftClose : PanelRightClose
  return (
    <div className="mb-2 flex h-8 shrink-0 items-center gap-1 border-b pb-2">
      <span className="text-sm font-semibold">{title}</span>
      <div className="ml-auto flex items-center gap-0.5">
        {actions}
        <Button variant="ghost" size="icon-xs" onClick={onHide} aria-label={`隐藏${title}`}>
          <Icon />
        </Button>
      </div>
    </div>
  )
}
