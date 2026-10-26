import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServerSettings, ShareLink } from '@shared/types'
import { Copy, Plus, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSession } from '@/hooks/use-session'
import { api, enc, formatDateTime } from '@/lib/api'

/**
 * Share button for the article on screen. Readers get the article's shared visitor link;
 * the admin gets the dialog that manages every link.
 */
export function ShareButton({ series, chapter, className }: { series: string; chapter: number; className?: string }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const admin = !!session.data?.admin
  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={() => setOpen(true)} title="分享这篇文章">
        <Share2 /> 分享
      </Button>
      {admin ? (
        <ShareDialog series={series} chapter={chapter} open={open} onOpenChange={setOpen} />
      ) : (
        <VisitorShareDialog series={series} chapter={chapter} open={open} onOpenChange={setOpen} />
      )}
    </>
  )
}

/** The one link every reader of this article shares. It is created on the first request. */
function VisitorShareDialog({ series, chapter, open, onOpenChange }: { series: string; chapter: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const key = ['share', 'visitor', series, chapter] as const
  const base = `/api/articles/${enc(series)}/${chapter}/share`
  const current = useQuery({
    queryKey: key,
    queryFn: () => api<{ link: ShareLink | null }>(base),
    enabled: open,
  })
  const make = useMutation({
    mutationFn: () => api<ShareLink>(base, { method: 'POST' }),
    onSuccess: async (link) => {
      qc.setQueryData(key, { link })
      toast.success((await copy(link.url)) ? '分享链接已生成，已复制' : '分享链接已生成')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })
  const link = current.data?.link

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>分享这篇文章</DialogTitle>
          <DialogDescription>
            打开链接的人会看到这篇文章的当前发布版本。所有人拿到的是同一个链接，直到管理员停用它为止。
          </DialogDescription>
        </DialogHeader>
        {current.isPending && <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>}
        {current.isError && <p className="py-4 text-center text-sm text-destructive">{String(current.error)}</p>}
        {current.data && link && (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm select-all" title={link.url}>
              {link.url}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="复制链接"
              title="复制"
              onClick={async () => {
                if (await copy(link.url)) toast.success('已复制')
                else toast.error('无法访问剪贴板，请手动复制')
              }}
            >
              <Copy />
            </Button>
          </div>
        )}
        {current.data && !link && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-3">
            <span className="text-sm text-muted-foreground">还没有分享链接。</span>
            <Button onClick={() => make.mutate(undefined)} disabled={make.isPending}>
              <Plus /> 生成分享链接
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}

function copy(text: string) {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}

function ShareDialog({ series, chapter, open, onOpenChange }: { series: string; chapter: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const key = ['admin', 'shares', series, chapter] as const
  const base = `/api/admin/articles/${enc(series)}/${chapter}/shares`
  const links = useQuery({ queryKey: key, queryFn: () => api<ShareLink[]>(base), enabled: open })
  const settings = useQuery({
    queryKey: ['admin', 'server-settings'],
    queryFn: () => api<ServerSettings>('/api/admin/server-settings'),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () => api<ShareLink>(base, { method: 'POST' }),
    onSuccess: async (link) => {
      void qc.invalidateQueries({ queryKey: key })
      toast.success((await copy(link.url)) ? '分享链接已创建，已复制' : '分享链接已创建')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/admin/shares/${enc(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('分享链接已停用')
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['share', 'visitor', series, chapter] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const s = settings.data
  const domain = s?.shareOrigin || s?.baseUrl || (typeof window === 'undefined' ? '' : window.location.origin)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>分享链接</DialogTitle>
          <DialogDescription>
            链接指向这篇文章的当前发布版本，形如 域名/sh/xxxx。链接域名：
            <code className="font-mono">{domain}</code>
            {s && !s.shareOrigin && '（主站域名；可在「设置 → 服务」中改为短域名）'}。
            标记为「游客链接」的是每篇文章唯一的共享链接，由游客首次请求时生成；其它链接由你创建。
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>
            <Plus /> 创建分享链接
          </Button>
        </div>

        {links.isPending && <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>}
        {links.data && links.data.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">还没有分享链接</p>}
        {links.data && links.data.length > 0 && (
          <ul className="grid gap-2">
            {links.data.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-sm select-all" title={l.url}>
                  {l.url}
                </code>
                {l.visitor && <span className="shrink-0 rounded-sm border px-1.5 text-[11px] text-muted-foreground">游客链接</span>}
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatDateTime(l.createdAt)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="复制链接"
                  title="复制"
                  onClick={async () => {
                    if (await copy(l.url)) toast.success('已复制')
                    else toast.error('无法访问剪贴板，请手动复制')
                  }}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="停用链接"
                  title="停用（之后访问会显示 404）"
                  disabled={revoke.isPending}
                  onClick={() => {
                    const note = l.visitor ? '这是游客链接，下次游客生成时会得到新的链接。' : ''
                    if (confirm(`停用分享链接 ${l.id}？停用后访问会显示 404，此操作不可撤销。${note}`)) revoke.mutate(l.id)
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
