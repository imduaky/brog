import type { ArticleRef, WorkspaceSeries } from '@shared/types'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, enc } from '@/lib/api'
import { useAdminMutation } from './hooks'

export function NewChapterDialog({ series, children }: { series: WorkspaceSeries[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const navigate = useNavigate()
  const existing = series.find((s) => s.slug === slug)
  const create = useAdminMutation((body: { series: string; title: string }) =>
    api<ArticleRef>('/api/admin/chapters', { method: 'POST', json: body }),
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const ref = await create.mutateAsync({ series: slug.trim(), title: title.trim() })
    setOpen(false)
    setTitle('')
    navigate(`/admin/edit/${enc(ref.series)}/${ref.chapter}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新建文章</DialogTitle>
            <DialogDescription>文章属于一个系列，系列不存在时会自动创建。新文章编号为系列中的下一篇。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="nc-series">系列（文件夹名）</Label>
            <Input id="nc-series" list="nc-series-list" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="系列名" required />
            <datalist id="nc-series-list">
              {series.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title}
                </option>
              ))}
            </datalist>
            {slug && (
              <p className="text-xs text-muted-foreground">
                {existing ? `将作为第 ${Math.max(0, ...existing.chapters.map((c) => c.chapter)) + 1} 篇` : '将创建新系列'}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-title">标题</Label>
            <Input id="nc-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !slug.trim() || !title.trim()}>
              创建并编辑
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
