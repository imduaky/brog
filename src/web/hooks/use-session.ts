import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@shared/types'
import { api } from '@/lib/api'

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionInfo>('/api/auth/session'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useRefreshSession() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['session'] })
}
