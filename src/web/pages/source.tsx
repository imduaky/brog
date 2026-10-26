import { useQuery } from '@tanstack/react-query'
import type { ArticleMetaResponse, SourceResponse } from '@shared/types'
import { ArrowLeft, GitCommitVertical } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import { SourceView } from '@/components/source-view'
import { ErrorState, Loading } from '@/components/states'
import { api, articlePath, enc } from '@/lib/api'

/** The Markdown source of an article on its own page (published version, or ?rev=). */
export default function SourcePage() {
  const { series = '', chapter = '' } = useParams()
  const [params] = useSearchParams()
  const rev = params.get('rev')
  const q = rev ? `?rev=${enc(rev)}` : ''
  const meta = useQuery({
    queryKey: ['article-meta', series, chapter, rev],
    queryFn: () => api<ArticleMetaResponse>(`/api/articles/${enc(series)}/${chapter}/meta${q}`),
  })
  const source = useQuery({
    queryKey: ['source', series, chapter, rev],
    queryFn: () => api<SourceResponse>(`/api/articles/${enc(series)}/${chapter}/source${q}`),
    staleTime: 60_000,
  })
  if (meta.isPending || source.isPending) return <Loading />
  if (meta.isError) return <ErrorState error={meta.error} />
  if (source.isError) return <ErrorState error={source.error} />
  const back = `${articlePath(series, Number(chapter))}${q}`
  return (
    <div className="mx-auto max-w-5xl">
      <title>{`原文 · ${meta.data.meta.title}`}</title>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to={back} className="clickable -ml-2 inline-flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" />
          返回文章
        </Link>
        {rev && (
          <span className="inline-flex items-center gap-1 rounded-sm border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs">
            <GitCommitVertical className="size-3.5" />
            历史版本 <code className="font-mono">{source.data.rev.slice(0, 7)}</code>
          </span>
        )}
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{meta.data.meta.title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {meta.data.series.title} · 第 {meta.data.chapter} 篇 · 原文（Markdown）
      </p>
      <SourceView text={source.data.text} fileName={`${meta.data.meta.title || 'content'}.md`} />
    </div>
  )
}
