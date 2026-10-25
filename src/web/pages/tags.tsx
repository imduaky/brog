import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArticleSummary, TagCount, TagRef } from '@shared/types'
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ArticleCard } from '@/components/article-card'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useSession } from '@/hooks/use-session'
import { api, enc } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Single clicks wait this long when they can become a double-click (admin rename). */
const CLICK_DELAY = 220

export default function TagsPage() {
  const session = useSession()
  const admin = !!session.data?.admin
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const selected = (params.get('tags') ?? '').split(',').filter(Boolean)

  const tags = useQuery({
    queryKey: ['tags', admin],
    queryFn: () => api<TagCount[]>(admin ? '/api/admin/tags' : '/api/tags'),
  })
  const articles = useQuery({
    queryKey: ['articles', 'by-tags', selected.join(',')],
    queryFn: () => api<ArticleSummary[]>(`/api/articles${selected.length ? `?tags=${selected.map(enc).join(',')}` : ''}`),
    placeholderData: (prev) => prev,
  })

  const setSelected = (keys: string[]) => setParams(keys.length ? { tags: keys.join(',') } : {}, { replace: true })
  const toggle = (key: string) =>
    setSelected(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tags'] })
    void qc.invalidateQueries({ queryKey: ['articles'] })
    void qc.invalidateQueries({ queryKey: ['admin'] })
  }

  const rename = async (tag: TagRef, name: string) => {
    try {
      await api(`/api/admin/tags/${tag.key}`, { method: 'PUT', json: { name } })
      toast.success(`标签已改为「${name.trim()}」，发布后读者可见`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const create = async (name: string) => {
    try {
      const ref = await api<TagRef>('/api/admin/tags', { method: 'POST', json: { name } })
      toast.success(`已新增标签「${ref.name}」，在文章信息中选择它`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (tags.isPending) return <Loading />
  if (tags.isError) return <ErrorState error={tags.error} />
  const byKey = new Map(tags.data.map((t) => [t.key, t]))
  const chosen = selected.map((k) => byKey.get(k)).filter((t): t is TagCount => !!t)

  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <title>标签</title>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">标签</h1>
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              <X /> 清除选择
            </Button>
          )}
          {admin && <span className="ml-auto text-xs text-muted-foreground">双击标签可修改名称</span>}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="标签">
          {tags.data.map((t, i) => (
            <TagChip
              key={t.key}
              tag={t}
              index={i}
              selected={selected.includes(t.key)}
              editable={admin}
              onToggle={() => toggle(t.key)}
              onRename={(name) => rename(t, name)}
            />
          ))}
          {admin && <NewTagChip onCreate={create} />}
        </div>
        {tags.data.length === 0 && !admin && <p className="text-sm text-muted-foreground">还没有标签</p>}
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground">
          {chosen.length === 0 ? (
            <span>全部文章</span>
          ) : (
            <>
              <span>同时带有</span>
              {chosen.map((t) => (
                <span key={t.key} className="font-medium text-foreground">
                  {t.name}
                </span>
              ))}
              <span>的文章</span>
            </>
          )}
          {articles.data && <span>· {articles.data.length} 篇</span>}
        </div>
        {articles.isPending ? (
          <Loading />
        ) : articles.isError ? (
          <ErrorState error={articles.error} />
        ) : articles.data.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">没有匹配的文章</p>
        ) : (
          <div className={cn('grid items-start gap-3', 'grid-cols-1 lg:grid-cols-2')}>
            {articles.data.map((a, i) => (
              <ArticleCard key={`${a.series}/${a.chapter}`} article={a} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function TagChip({
  tag,
  index,
  selected,
  editable,
  onToggle,
  onRename,
}: {
  tag: TagCount
  index: number
  selected: boolean
  editable: boolean
  onToggle: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tag.name)
  const pending = useRef<number | null>(null)
  const cancelled = useRef(false)

  const clearPending = () => {
    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = null
  }
  useEffect(() => clearPending, [])

  const startEdit = () => {
    clearPending()
    setDraft(tag.name)
    cancelled.current = false
    setEditing(true)
  }
  const finish = () => {
    if (cancelled.current) return
    const next = draft.trim()
    setEditing(false)
    if (next && next !== tag.name) onRename(next)
  }

  const style = { animationDelay: `${Math.min(index, 20) * 18}ms` }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`修改标签 ${tag.name}`}
        value={draft}
        maxLength={30}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            setEditing(false)
          }
        }}
        className="h-10 w-40 rounded-md border border-ring bg-background px-3 text-sm outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        if (!editable) return onToggle()
        // Wait briefly: the second click of a double-click must not toggle the selection.
        clearPending()
        pending.current = window.setTimeout(() => {
          pending.current = null
          onToggle()
        }, CLICK_DELAY)
      }}
      onDoubleClick={() => {
        if (editable) startEdit()
      }}
      onKeyDown={(e) => {
        if (editable && e.key === 'F2') startEdit()
      }}
      className={cn(
        'chip motion-rise flex h-10 min-w-28 items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm',
        'hover:border-foreground/40',
        tag.count === 0 && 'border-dashed text-muted-foreground',
      )}
      style={style}
      title={editable ? '单击选择，双击修改名称' : undefined}
    >
      <span className="truncate">{tag.name}</span>
      <span className={cn('font-mono text-xs', selected ? 'opacity-80' : 'text-muted-foreground')}>{tag.count}</span>
    </button>
  )
}

function NewTagChip({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const done = useRef(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft('')
          done.current = false
          setOpen(true)
        }}
        aria-label="新增标签"
        title="新增标签"
        className="chip motion-rise flex h-10 w-10 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    )
  }
  return (
    <input
      autoFocus
      aria-label="新标签名称"
      placeholder="新标签"
      value={draft}
      maxLength={30}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!done.current && draft.trim()) onCreate(draft.trim())
        setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          done.current = true
          if (draft.trim()) onCreate(draft.trim())
          setOpen(false)
        }
        if (e.key === 'Escape') {
          done.current = true
          setOpen(false)
        }
      }}
      className="motion-pop h-10 w-40 rounded-md border border-ring bg-background px-3 text-sm outline-none"
    />
  )
}
