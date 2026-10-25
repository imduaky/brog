import { useQuery } from '@tanstack/react-query'
import type { ArticleSummary, SeriesSummary } from '@shared/types'
import { useParams } from 'react-router'
import { ArticleCard } from '@/components/article-card'
import { ErrorState, Loading } from '@/components/states'
import { api, enc } from '@/lib/api'

export default function SeriesPage() {
  const { series = '' } = useParams()
  const info = useQuery({ queryKey: ['series', series], queryFn: () => api<SeriesSummary>(`/api/series/${enc(series)}`) })
  const articles = useQuery({
    queryKey: ['articles', 'series', series],
    queryFn: () => api<ArticleSummary[]>(`/api/articles?series=${enc(series)}`),
  })
  if (info.isPending || articles.isPending) return <Loading />
  if (info.isError) return <ErrorState error={info.error} />
  if (articles.isError) return <ErrorState error={articles.error} />
  const sorted = [...articles.data].sort((a, b) => a.chapter - b.chapter)
  return (
    <div className="mx-auto max-w-3xl">
      <title>{info.data.title}</title>
      <h1 className="text-2xl font-semibold">{info.data.title}</h1>
      {info.data.description && <p className="mt-2 text-muted-foreground">{info.data.description}</p>}
      <div className="mt-8 grid gap-3">
        {sorted.map((a) => (
          <ArticleCard key={a.chapter} article={a} />
        ))}
      </div>
    </div>
  )
}
