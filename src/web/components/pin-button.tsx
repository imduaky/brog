import type { PinKind } from '@shared/types'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAdminPins } from '@/hooks/use-pins'

/** Admin-only: pins this article, series or tag to the top of the home list. Renders nothing for readers. */
export function PinButton({ kind, pinKey, className }: { kind: PinKind; pinKey: string; className?: string }) {
  const { admin, ready, isPinned, toggle, save } = useAdminPins()
  if (!admin || !ready) return null
  const pinned = isPinned(kind, pinKey)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={save.isPending}
      onClick={() => toggle(kind, pinKey)}
      title={pinned ? '从首页顶部移除' : '显示在首页列表顶部'}
    >
      {pinned ? <PinOff /> : <Pin />}
      {pinned ? '取消置顶' : '置顶'}
    </Button>
  )
}
