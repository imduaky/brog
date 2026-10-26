import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SiteSettings } from '@shared/types'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

/** Saves one section of the site settings; the server keeps the other fields as they are. */
export function useSaveSite(success: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<SiteSettings>) => api<SiteSettings>('/api/admin/site-settings', { method: 'PUT', json: patch }),
    onSuccess: () => {
      toast.success(success)
      void qc.invalidateQueries({ queryKey: ['site'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })
}

export function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return next
}

/** Up / down / delete buttons at the end of an editable list row. */
export function RowActions({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number
  count: number
  onMove: (by: -1 | 1) => void
  onRemove: () => void
  label: string
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`上移${label}`} disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUp />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`下移${label}`} disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDown />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除${label}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}
