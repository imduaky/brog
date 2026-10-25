import { useQuery } from '@tanstack/react-query'
import type { ArticleSummary, HomeBackground } from '@shared/types'
import { ArticleCard } from '@/components/article-card'
import { ErrorState, Loading } from '@/components/states'
import { useTheme } from '@/hooks/use-theme'
import { useSite } from '@/hooks/use-site'
import { api, assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function HomePage() {
  const site = useSite()
  const articles = useQuery({ queryKey: ['articles'], queryFn: () => api<ArticleSummary[]>('/api/articles') })
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
        <div className={cn('grid items-start gap-4', grid)}>
          {articles.data.map((a, i) => (
            <ArticleCard key={`${a.series}/${a.chapter}`} article={a} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The home page background: a solid color behind the list, per mode. */
function HomeBackdrop({ home }: { home: HomeBackground }) {
  const { resolved } = useTheme()
  return <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ backgroundColor: home.color[resolved] }} />
}
