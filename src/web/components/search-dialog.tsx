import { useQuery } from '@tanstack/react-query'
import type { SearchArticleHit, SearchCommitHit, SearchResponse } from '@shared/types'
import { useState } from 'react'
import { Link } from 'react-router'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDebounced } from '@/hooks/use-debounced'
import { useSession } from '@/hooks/use-session'
import { api, articlePath, enc, formatDateTime } from '@/lib/api'

const MARK_START = '\u0002'
const MARK_END = '\u0003'

/** Renders the server's snippet with matches as <mark>. Plain text only, no HTML injection. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(MARK_START).map((part, i) => {
        if (i === 0) return <span key={i}>{part}</span>
        const [hit = '', ...rest] = part.split(MARK_END)
        return (
          <span key={i}>
            <mark className="bg-yellow-200/70 text-inherit dark:bg-yellow-500/30">{hit}</mark>
            {rest.join(MARK_END)}
          </span>
        )
      })}
    </>
  )
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [input, setInput] = useState('')
  const q = useDebounced(input.trim(), 200)
  const session = useSession()
  const admin = !!session.data?.admin
  const prefix = admin ? '/admin' : ''
  const search = useQuery({
    queryKey: ['search', q, admin],
    queryFn: () => api<SearchResponse>(`/api/search?q=${enc(q)}`),
    enabled: open && q.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80svh] gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">搜索</DialogTitle>
          <DialogDescription className="sr-only">搜索文章和提交说明</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索文章、提交说明…"
          aria-label="搜索"
        />
        <div className="min-h-0 overflow-y-auto pr-1">
          {q.length < 2 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">输入至少两个字符</p>
          ) : search.isPending && !search.data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">搜索中…</p>
          ) : search.isError ? (
            <p className="py-8 text-center text-sm text-destructive">{String(search.error)}</p>
          ) : search.data ? (
            <Results data={search.data} prefix={prefix} onNavigate={close} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Results({ data, prefix, onNavigate }: { data: SearchResponse; prefix: string; onNavigate: () => void }) {
  const empty = data.articles.length === 0 && data.commits.length === 0
  return (
    <div className="grid gap-5">
      {!data.fullText && <p className="text-xs text-muted-foreground">全文搜索已关闭，仅匹配标题、标签和摘要。</p>}
      {empty && <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的内容</p>}
      {data.articles.length > 0 && (
        <section className="grid gap-1">
          <h3 className="px-2 text-xs font-medium text-muted-foreground">文章</h3>
          {data.articles.map((a) => (
            <ArticleResult key={`${a.series}/${a.chapter}`} hit={a} onNavigate={onNavigate} />
          ))}
        </section>
      )}
      {data.commits.length > 0 && (
        <section className="grid gap-1">
          <h3 className="px-2 text-xs font-medium text-muted-foreground">提交</h3>
          {data.commits.map((c) => (
            <CommitResult key={c.oid} hit={c} prefix={prefix} onNavigate={onNavigate} />
          ))}
        </section>
      )}
    </div>
  )
}

function ArticleResult({ hit, onNavigate }: { hit: SearchArticleHit; onNavigate: () => void }) {
  return (
    <Link
      to={articlePath(hit.series, hit.chapter)}
      onClick={onNavigate}
      className="clickable block px-2 py-2"
    >
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{hit.title}</span>
        <span className="text-xs text-muted-foreground">
          {hit.seriesTitle} · 第 {hit.chapter} 篇
        </span>
      </span>
      {hit.snippet && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground"><Snippet text={hit.snippet} /></span>}
    </Link>
  )
}

function CommitResult({ hit, prefix, onNavigate }: { hit: SearchCommitHit; prefix: string; onNavigate: () => void }) {
  const parent = hit.parents[0]
  const body = (
    <>
      <span className="block text-sm">{hit.subject}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <code className="font-mono">{hit.oid.slice(0, 7)}</code>
        <span>{formatDateTime(hit.time)}</span>
        {hit.articles.map((a) => (
          <span key={`${a.series}/${a.chapter}`}>{a.title}</span>
        ))}
      </span>
    </>
  )
  // Commits open as a diff against their parent, the same view as the history page.
  return parent ? (
    <Link to={`${prefix}/compare/${parent}...${hit.oid}`} onClick={onNavigate} className="clickable block px-2 py-2">
      {body}
    </Link>
  ) : (
    <div className="block px-2 py-2">{body}</div>
  )
}

