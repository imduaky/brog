import { useQuery } from '@tanstack/react-query'
import type { SeriesSummary } from '@shared/types'
import { Link } from 'react-router'
import { ErrorState, Loading } from '@/components/states'
import { api, assetUrl, enc, formatDate } from '@/lib/api'

export default function SeriesListPage() {
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<SeriesSummary[]>('/api/series') })
  if (series.isPending) return <Loading />
  if (series.isError) return <ErrorState error={series.error} />
  return (
    <div className="mx-auto max-w-3xl">
      <title>系列</title>
      <h1 className="mb-6 text-2xl font-semibold">系列</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {series.data.map((s) => (
          <Link
            key={s.slug}
            to={`/s/${enc(s.slug)}`}
            className="flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/25 hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {s.cover && <img src={assetUrl(s.cover)} alt="" className="h-32 w-full object-cover" loading="lazy" />}
            <div className="p-4">
              <h2 className="font-semibold">{s.title}</h2>
              {s.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {s.chapters.length} 篇 · 更新于 {formatDate(s.updatedAt)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
