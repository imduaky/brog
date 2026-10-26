import type { PageRef } from '@shared/types'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, enc } from '@/lib/api'
import { useAdminMutation } from './hooks'

const KIND_HINT: Record<PageRef['kind'], string> = {
  markdown: 'Markdown 页面，写法与文章相同，可以插入图片。',
  html: '网页页面，直接写 HTML 与 JavaScript，在独立的沙箱中运行，拿不到站点的登录状态。',
}

/** Creates _pages/<slug>/ and opens it in the editor. */
export function NewPageDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PageRef['kind']>('markdown')
  const navigate = useNavigate()
  const create = useAdminMutation((body: { slug: string; title: string; kind: PageRef['kind'] }) =>
    api<PageRef>('/api/admin/pages', { method: 'POST', json: body }),
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const ref = await create.mutateAsync({ slug: slug.trim(), title: title.trim(), kind })
    setOpen(false)
    setSlug('')
    setTitle('')
    navigate(`/admin/edit-page/${enc(ref.slug)}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新建页面</DialogTitle>
            <DialogDescription>页面可以放进导航栏。地址为 /p/名称，名称只能用字母、数字、中文和 - _ 。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>类型</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as PageRef['kind'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="markdown">Markdown 页面</SelectItem>
                <SelectItem value="html">网页页面（HTML）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-slug">名称（地址）</Label>
            <Input id="np-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="about" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-title">标题</Label>
            <Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
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
