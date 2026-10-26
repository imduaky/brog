import { useQuery } from '@tanstack/react-query'
import type { ArticleSummary, HomeBackground, PinnedItem } from '@shared/types'
import { createPortal } from 'react-dom'
import { ArticleCard } from '@/components/article-card'
import { PinnedSeriesCard, PinnedTagCard } from '@/components/pinned-card'
import { ErrorState, Loading } from '@/components/states'
import { useTheme } from '@/hooks/use-theme'
import { useSite } from '@/hooks/use-site'
import { api, assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function HomePage() {
  const site = useSite()
  const articles = useQuery({ queryKey: ['articles'], queryFn: () => api<ArticleSummary[]>('/api/articles') })
  const pins = useQuery({ queryKey: ['pins'], queryFn: () => api<PinnedItem[]>('/api/pins') })
  const settings = site.data?.settings
  const columns = settings?.listColumns ?? 'auto'

  // Auto: two columns once the page is wide enough for both to read comfortably.
  // The width cap keeps single-column lists from stretching across large screens.
  const wrap = columns === 1 ? 'max-w-3xl' : 'max-w-5xl'
  const grid =
    columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2'

  return (
    <div className={cn('mx-auto', wrap)}>
      <title>{settings?.title}</title>
      {settings && <HomeBackdrop home={settings.home} />}
      {settings?.description && <p className="mb-8 text-muted-foreground">{settings.description}</p>}
      {articles.isPending ? (
        <Loading />
      ) : articles.isError ? (
        <ErrorState error={articles.error} />
      ) : articles.data.length === 0 ? (
        <p className="py-20 text-center text-muted-foreground">还没有文章</p>
      ) : (
        <ArticleList articles={articles.data} pins={pins.data ?? []} grid={grid} />
      )}
    </div>
  )
}

/** Pinned items first, in the admin's order; pinned articles are not repeated below. */
function ArticleList({ articles, pins, grid }: { articles: ArticleSummary[]; pins: PinnedItem[]; grid: string }) {
  const pinnedArticles = new Set(pins.filter((p) => p.kind === 'article').map((p) => p.key))
  const rest = articles.filter((a) => !pinnedArticles.has(`${a.series}/${a.chapter}`))
  return (
    <div className={cn('grid items-start gap-4', grid)}>
      {pins.map((p, i) =>
        p.kind === 'article' ? (
          <ArticleCard key={`pin:${p.key}`} article={p.article} index={i} pinned />
        ) : p.kind === 'series' ? (
          <PinnedSeriesCard key={`pin-s:${p.key}`} series={p.series} index={i} />
        ) : (
          <PinnedTagCard key={`pin-t:${p.key}`} tag={p.tag} index={i} />
        ),
      )}
      {rest.map((a, i) => (
        <ArticleCard key={`${a.series}/${a.chapter}`} article={a} index={pins.length + i} />
      ))}
    </div>
  )
}

/**
 * The home page background: a solid color behind the list, per mode. Rendered into
 * <body> so it sits behind the whole page; inside the page's fade wrapper (its own
 * stacking context) it would cover the footer.
 */
function HomeBackdrop({ home }: { home: HomeBackground }) {
  const { resolved } = useTheme()
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ backgroundColor: home.color[resolved] }} />,
    document.body,
  )
}
