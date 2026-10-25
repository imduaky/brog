import type { CommitInfo } from '@shared/types'
import { GitCompare } from 'lucide-react'
import { Link } from 'react-router'
import { formatDateTime } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface CommitTreeItem extends Pick<CommitInfo, 'oid' | 'subject' | 'time'> {}

/**
 * Vertical commit tree: one dot per commit on a single line, newest first.
 * The current version is filled. Clicking a row opens that version.
 */
export function CommitTree({
  commits,
  current,
  hrefFor,
  compareHref,
}: {
  commits: CommitTreeItem[]
  current: string
  hrefFor: (c: CommitTreeItem, index: number) => string
  /** Link that compares this commit with the one before it, or null when there is none. */
  compareHref?: (c: CommitTreeItem, index: number) => string | null
}) {
  if (commits.length === 0) return <p className="text-sm text-muted-foreground">还没有发布过版本</p>
  return (
    <ol className="relative">
      <span className="absolute top-3 bottom-3 left-[11px] w-px bg-border" aria-hidden />
      {commits.map((c, i) => {
        const isCurrent = c.oid === current
        const compare = compareHref?.(c, i) ?? null
        return (
          <li key={c.oid} className="relative pl-8">
            <span
              aria-hidden
              className={cn(
                'absolute top-[11px] left-[7px] size-[9px] rounded-full border-2 bg-background',
                isCurrent ? 'border-foreground bg-foreground' : 'border-muted-foreground',
              )}
            />
            <div className={cn('group relative mb-1 flex items-start gap-1 rounded-sm', isCurrent && 'bg-accent')}>
              <Link
                to={hrefFor(c, i)}
                replace
                aria-current={isCurrent ? 'step' : undefined}
                className="clickable min-w-0 flex-1 px-2 py-1.5"
              >
                <span className="line-clamp-2 text-sm">{c.subject}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <code className="font-mono">{c.oid.slice(0, 7)}</code>
                  <span>{formatDateTime(c.time)}</span>
                  {i === 0 && <span className="text-foreground">最新</span>}
                </span>
              </Link>
              {compare && (
                <Link
                  to={compare}
                  title="与上一版本对比"
                  aria-label="与上一版本对比"
                  className="clickable mt-1 mr-1 shrink-0 p-1.5 text-muted-foreground opacity-70 group-hover:opacity-100"
                >
                  <GitCompare className="size-3.5" />
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
