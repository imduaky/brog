import type { ArticleSummary } from '@shared/types'
import { Pin } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { useTheme } from '@/hooks/use-theme'
import { articlePath, assetUrl, formatDate } from '@/lib/api'

/**
 * A card on the home list. The article's preview color tints the card and marks its
 * left edge, so the list reads as a set of colored notes on the paper.
 */
export function ArticleCard({ article, index = 0, pinned }: { article: ArticleSummary; index?: number; pinned?: boolean }) {
  const { resolved } = useTheme()
  const tint = article.theme?.[resolved]
  return (
    <Link
      to={articlePath(article.series, article.chapter)}
      className="motion-rise group flex gap-4 rounded-lg border bg-card p-4 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      style={{
        animationDelay: `${Math.min(index, 8) * 30}ms`,
        ...(tint
          ? {
              backgroundColor: `color-mix(in oklch, ${tint} 34%, var(--card))`,
              borderLeftColor: tint,
              borderLeftWidth: 4,
            }
          : {}),
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {pinned && <PinnedMark />}
          {article.seriesTitle} · 第 {article.chapter} 篇 · {formatDate(article.createdAt)}
        </div>
        <h2 className="text-lg font-semibold group-hover:underline group-hover:underline-offset-4">{article.title}</h2>
        {article.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.summary}</p>}
        {article.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {article.tags.map((t) => (
              <Badge key={t.key} variant="secondary">
                {t.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {article.cover && (
        <img src={assetUrl(article.cover)} alt="" loading="lazy" className="hidden h-24 w-36 shrink-0 rounded-md object-cover sm:block" />
      )}
    </Link>
  )
}

/** Small "置顶" marker shared by every pinned card on the home list. */
export function PinnedMark() {
  return (
    <span className="mr-1 inline-flex items-center gap-0.5 font-medium text-foreground">
      <Pin className="size-3" aria-hidden />
      置顶
    </span>
  )
}
