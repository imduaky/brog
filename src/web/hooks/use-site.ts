import { useQuery } from '@tanstack/react-query'
import type { SiteInfo } from '@shared/types'
import { api } from '@/lib/api'

export function useSite() {
  return useQuery({ queryKey: ['site'], queryFn: () => api<SiteInfo>('/api/site'), staleTime: 60_000 })
}
