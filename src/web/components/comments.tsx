import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentItem, CommentsResponse } from '@shared/types'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/hooks/use-session'
import { api, enc, formatDateTime } from '@/lib/api'

const NAME_KEY = 'brog-comment-name'

/** The name a reader used last time on this device. A convenience only: nothing depends on it. */
function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Comments below an article. Rendered only when the site says comments are on. */
export function Comments({ series, chapter }: { series: string; chapter: number }) {
  const qc = useQueryClient()
  const session = useSession()
  const admin = !!session.data?.admin
  const key = ['comments', series, chapter]
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<CommentsResponse>(`/api/comments/${enc(series)}/${chapter}`),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/admin/comments/${enc(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('评论已删除')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const data = list.data
  return (
    <section className="mt-12 border-t pt-8" aria-labelledby="comments-title">
      <h2 id="comments-title" className="mb-6 text-lg font-semibold">
        评论 {data && data.total > 0 && <span className="text-sm font-normal text-muted-foreground">{data.total}</span>}
      </h2>

      {list.isPending && <p className="py-6 text-sm text-muted-foreground">加载中…</p>}
      {list.isError && (
        <p className="py-6 text-sm text-destructive">{list.error instanceof Error ? list.error.message : String(list.error)}</p>
      )}
      {data && data.comments.length === 0 && <p className="py-6 text-sm text-muted-foreground">还没有评论，来说第一句吧。</p>}
      {data && data.comments.length > 0 && (
        <ol className="grid gap-3">
          {data.comments.map((c) => (
            <CommentRow key={c.id} comment={c} canDelete={admin} onDelete={() => remove.mutate(c.id)} />
          ))}
        </ol>
      )}
      {data && data.total > data.comments.length && (
        <p className="mt-3 text-xs text-muted-foreground">共 {data.total} 条，仅显示前 {data.comments.length} 条。</p>
      )}

      <CommentForm series={series} chapter={chapter} onPosted={() => void qc.invalidateQueries({ queryKey: key })} />
    </section>
  )
}

function CommentRow({ comment: c, canDelete, onDelete }: { comment: CommentItem; canDelete: boolean; onDelete: () => void }) {
  return (
    <li className="motion-rise grid gap-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {c.avatarUrl && <img src={c.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-5 rounded-sm border" />}
        <span className="font-medium">{c.name}</span>
        {c.guest && <span className="rounded-sm border px-1.5 text-[11px] text-muted-foreground">访客</span>}
        <time className="text-xs text-muted-foreground" dateTime={new Date(c.createdAt).toISOString()}>
          {formatDateTime(c.createdAt)}
        </time>
        <span className="ml-auto flex items-center gap-1">
          {c.url && (
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="clickable px-2 py-0.5 text-xs text-muted-foreground">
              在 GitHub 查看
            </a>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="删除评论"
              title="删除评论（从 GitHub 删除）"
              onClick={() => {
                if (confirm('从 GitHub 上删除这条评论？此操作不可恢复。')) onDelete()
              }}
            >
              <Trash2 />
            </Button>
          )}
        </span>
      </div>
      <p className="text-[15px] leading-7 break-words whitespace-pre-wrap">{c.body}</p>
    </li>
  )
}

function CommentForm({ series, chapter, onPosted }: { series: string; chapter: number; onPosted: () => void }) {
  const [name, setName] = useState(savedName)
  const [text, setText] = useState('')
  const post = useMutation({
    mutationFn: () =>
      api(`/api/comments/${enc(series)}/${chapter}`, { method: 'POST', json: { name: name.trim(), text: text.trim() } }),
    onSuccess: () => {
      try {
        localStorage.setItem(NAME_KEY, name.trim())
      } catch {}
      setText('')
      toast.success('评论已发表')
      onPosted()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  return (
    <form
      className="mt-8 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        post.mutate(undefined)
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="昵称" maxLength={30} required aria-label="昵称" />
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="写下你的看法（纯文本，最多 2000 字）"
        rows={4}
        maxLength={2000}
        required
        aria-label="评论内容"
      />
      <Button type="submit" className="justify-self-end" disabled={post.isPending || !name.trim() || !text.trim()}>
        {post.isPending ? '发表中…' : '发表评论'}
      </Button>
    </form>
  )
}
