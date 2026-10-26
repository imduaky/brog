import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminPin, Pin } from '@shared/types'
import { toast } from 'sonner'
import { useSession } from '@/hooks/use-session'
import { api } from '@/lib/api'

/** The admin's pinned list (all pins, published or not). Disabled for readers. */
export function useAdminPins() {
  const session = useSession()
  const admin = !!session.data?.admin
  const pins = useQuery({
    queryKey: ['admin', 'pins'],
    queryFn: () => api<AdminPin[]>('/api/admin/pins'),
    enabled: admin,
  })
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (next: Pin[]) =>
      api<AdminPin[]>('/api/admin/pins', { method: 'PUT', json: { pins: next.map(({ kind, key }) => ({ kind, key })) } }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'pins'], data)
      void qc.invalidateQueries({ queryKey: ['pins'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })
  const list = pins.data ?? []
  const isPinned = (kind: Pin['kind'], key: string) => list.some((p) => p.kind === kind && p.key === key)
  /** New pins go to the end of the list. */
  const toggle = (kind: Pin['kind'], key: string) =>
    save.mutate(isPinned(kind, key) ? list.filter((p) => !(p.kind === kind && p.key === key)) : [...list, { kind, key }])
  return { admin, pins: list, ready: pins.isSuccess, isPinned, toggle, save }
}
