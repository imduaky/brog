import type { SeriesSummary, TagCount } from '@shared/types'
import { BookOpen, Hash } from 'lucide-react'
import { Link } from 'react-router'
import { PinnedMark } from '@/components/article-card'
import { enc, formatDate } from '@/lib/api'

const CARD =
  'motion-rise group flex gap-4 rounded-lg border bg-card p-4 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

/** A pinned series on the home list, the same size as an article card. */
export function PinnedSeriesCard({ series, index = 0 }: { series: SeriesSummary; index?: number }) {
  return (
    <Link to={`/s/${enc(series.slug)}`} className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <PinnedMark />
          合集 · {series.chapters.length} 篇{series.updatedAt ? ` · 更新于 ${formatDate(series.updatedAt)}` : ''}
        </div>
        <h2 className="flex items-center gap-2 text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {series.title}
        </h2>
        {series.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{series.description}</p>}
      </div>
    </Link>
  )
}

/** A pinned tag: opens the tag page with that tag selected. */
export function PinnedTagCard({ tag, index = 0 }: { tag: TagCount; index?: number }) {
  return (
    <Link to={`/tags?tags=${enc(tag.key)}`} className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <PinnedMark />
          标签 · {tag.count} 篇
        </div>
        <h2 className="flex items-center gap-2 text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
          <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {tag.name}
        </h2>
      </div>
    </Link>
  )
}
