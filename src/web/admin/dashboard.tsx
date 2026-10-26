import { useQuery } from '@tanstack/react-query'
import type { StatusEntry, WorkspaceSeries, WorkspaceStatus } from '@shared/types'
import { AlertTriangle, FileDiff, Minus, MoreHorizontal, Plus, Rocket, Trash2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorState, Loading } from '@/components/states'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, enc, formatDateTime } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DiffView } from '@/components/diff-view'
import type { PageRef } from '@shared/types'
import { useAdminMutation } from './hooks'
import { NewChapterDialog } from './new-chapter-dialog'
import { NewPageDialog } from './new-page-dialog'

const STATUS_LABEL: Record<string, string> = { M: '修改', A: '新增', D: '删除', '?': '新文件', U: '冲突' }

export function useWorkspaceStatus() {
  return useQuery({ queryKey: ['admin', 'status'], queryFn: () => api<WorkspaceStatus>('/api/admin/status') })
}

export default function DashboardPage() {
  const status = useWorkspaceStatus()
  const tree = useQuery({ queryKey: ['admin', 'tree'], queryFn: () => api<WorkspaceSeries[]>('/api/admin/tree') })
  const pages = useQuery({ queryKey: ['admin', 'pages'], queryFn: () => api<(PageRef & { dirty: boolean })[]>('/api/admin/pages') })

  if (status.isPending || tree.isPending || pages.isPending) return <Loading />
  if (status.isError) return <ErrorState error={status.error} />
  if (tree.isError) return <ErrorState error={tree.error} />
  if (pages.isError) return <ErrorState error={pages.error} />

  return (
    <div className="relative h-full overflow-y-auto scroll-quiet">
      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {status.data.warning && <WarningBanner message={status.data.warning} />}
        <div className="grid content-start gap-6">
          <ArticleTree series={tree.data} />
          <PagesCard pages={pages.data} />
        </div>
        <div className="grid content-start gap-6">
          <ChangesCard status={status.data} />
          <PublishCard status={status.data} />
        </div>
      </div>
    </div>
  )
}

function WarningBanner({ message }: { message: string }) {
  const dismiss = useAdminMutation(() => api('/api/admin/status/dismiss-warning', { method: 'POST' }))
  return (
    <div className="flex items-start gap-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm lg:col-span-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{message}</p>
      <Button variant="ghost" size="icon-xs" onClick={() => dismiss.mutate(undefined)} aria-label="关闭">
        <X />
      </Button>
    </div>
  )
}

function ArticleTree({ series }: { series: WorkspaceSeries[] }) {
  const remove = useAdminMutation(
    (path: string) => api(`/api/admin/file?path=${enc(path)}`, { method: 'DELETE' }),
    '已从工作区删除，提交后生效',
  )
  return (
    <Card className="content-start gap-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>文章</CardTitle>
          <CardDescription>工作区中的内容（包含未提交的修改）</CardDescription>
        </div>
        <NewChapterDialog series={series}>
          <Button size="sm">
            <Plus /> 新建
          </Button>
        </NewChapterDialog>
      </CardHeader>
      <CardContent className="grid gap-4">
        {series.length === 0 && <p className="text-sm text-muted-foreground">还没有文章</p>}
        {series.map((s) => (
          <div key={s.slug}>
            <div className="mb-1 flex items-center gap-2 px-2 text-sm font-medium">
              {s.title}
              {s.title !== s.slug && <span className="text-xs font-normal text-muted-foreground">{s.slug}/</span>}
            </div>
            <ul>
              {s.chapters.map((c) => (
                <li key={c.chapter} className="group flex items-center rounded-md hover:bg-accent">
                  <Link to={`/admin/edit/${enc(s.slug)}/${c.chapter}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{c.chapter}</span>
                    <span className="truncate">{c.title}</span>
                    {c.dirty && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="有未提交的修改" />
                        </TooltipTrigger>
                        <TooltipContent>有未提交的修改</TooltipContent>
                      </Tooltip>
                    )}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label="更多">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/s/${enc(s.slug)}/${c.chapter}`}>查看已发布版本</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          if (confirm(`从工作区删除「${c.title}」整个文件夹？提交后生效，可以通过历史恢复。`)) {
                            remove.mutate(`${s.slug}/${c.chapter}`)
                          }
                        }}
                      >
                        <Trash2 /> 删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** Custom pages in the workspace (_pages/): they show in the navigation once published. */
function PagesCard({ pages }: { pages: (PageRef & { dirty: boolean })[] }) {
  const remove = useAdminMutation(
    (slug: string) => api(`/api/admin/file?path=${enc(`_pages/${slug}`)}`, { method: 'DELETE' }),
    '已从工作区删除，提交后生效',
  )
  return (
    <Card className="content-start gap-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>页面</CardTitle>
          <CardDescription>导航中的自定义页面。发布后读者才能看到。</CardDescription>
        </div>
        <NewPageDialog>
          <Button size="sm">
            <Plus /> 新建
          </Button>
        </NewPageDialog>
      </CardHeader>
      <CardContent>
        {pages.length === 0 && <p className="text-sm text-muted-foreground">还没有页面</p>}
        <ul>
          {pages.map((p) => (
            <li key={p.slug} className="group flex items-center rounded-md hover:bg-accent">
              <Link to={`/admin/edit-page/${enc(p.slug)}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <span className="truncate">{p.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.kind === 'html' ? '网页' : 'Markdown'}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">/p/{p.slug}</span>
                {p.dirty && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="有未提交的修改" />}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label="更多">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/p/${enc(p.slug)}`}>查看已发布版本</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      if (confirm(`从工作区删除页面「${p.title}」？提交后生效，可以通过历史恢复。`)) remove.mutate(p.slug)
                    }}
                  >
                    <Trash2 /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function isStaged(e: StatusEntry) {
  return e.index !== ' ' && e.index !== '?'
}
function isUnstaged(e: StatusEntry) {
  return e.worktree !== ' '
}

function ChangesCard({ status }: { status: WorkspaceStatus }) {
  const [message, setMessage] = useState('')
  const [all, setAll] = useState(false)
  const [diff, setDiff] = useState<{ path: string; staged: boolean; text: string } | null>(null)
  const staged = status.changes.filter(isStaged)
  const unstaged = status.changes.filter(isUnstaged)

  const stage = useAdminMutation((paths: string[]) => api('/api/admin/stage', { method: 'POST', json: { paths } }))
  const unstage = useAdminMutation((paths: string[]) => api('/api/admin/unstage', { method: 'POST', json: { paths } }))
  const discard = useAdminMutation((paths: string[]) => api('/api/admin/discard', { method: 'POST', json: { paths } }), '已丢弃修改')
  const commit = useAdminMutation(
    (body: { message: string; all: boolean }) => api<{ oid: string }>('/api/admin/commit', { method: 'POST', json: body }),
    (r) => `已提交 ${r.oid.slice(0, 7)}`,
  )

  async function showDiff(path: string, isStagedDiff: boolean) {
    const r = await api<{ diff: string }>(`/api/admin/diff?path=${enc(path)}${isStagedDiff ? '&staged=1' : ''}`)
    setDiff({ path, staged: isStagedDiff, text: r.diff })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await commit.mutateAsync({ message, all })
    setMessage('')
  }

  const canCommit = message.trim() && (staged.length > 0 || (all && status.changes.length > 0))

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>更改</CardTitle>
        <CardDescription>和 git 一样：先暂存，再提交。提交不会发布，发布见下方。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ChangeList
          title="已暂存"
          entries={staged}
          column="index"
          action={{ icon: <Minus />, label: '取消暂存', run: (p) => unstage.mutate(p) }}
          onDiff={(p) => showDiff(p, true)}
        />
        <ChangeList
          title="未暂存"
          entries={unstaged}
          column="worktree"
          action={{ icon: <Plus />, label: '暂存', run: (p) => stage.mutate(p) }}
          onDiff={(p) => showDiff(p, false)}
          onDiscard={(p) => {
            if (confirm(`丢弃 ${p.length} 个文件的未暂存修改？此操作不可恢复。`)) discard.mutate(p)
          }}
        />
        <form onSubmit={submit} className="grid gap-2 border-t pt-4">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="提交说明" rows={2} />
          <div className="flex items-center gap-3">
            <Label className="text-sm font-normal">
              <Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} />
              包含所有未暂存的更改
            </Label>
            <Button type="submit" className="ml-auto" disabled={!canCommit || commit.isPending}>
              提交 Commit
            </Button>
          </div>
        </form>
      </CardContent>
      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-h-[85svh] overflow-y-auto scroll-quiet sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {diff?.path} {diff?.staged ? '（已暂存）' : ''}
            </DialogTitle>
          </DialogHeader>
          {diff && <DiffView diff={diff.text} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ChangeList({
  title,
  entries,
  column,
  action,
  onDiff,
  onDiscard,
}: {
  title: string
  entries: StatusEntry[]
  column: 'index' | 'worktree'
  action: { icon: React.ReactNode; label: string; run: (paths: string[]) => void }
  onDiff: (path: string) => void
  onDiscard?: (paths: string[]) => void
}) {
  const paths = entries.map((e) => e.path)
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        {title} <span className="text-muted-foreground">{entries.length}</span>
        {entries.length > 0 && (
          <div className="ml-auto flex gap-1">
            {onDiscard && (
              <Button variant="ghost" size="xs" onClick={() => onDiscard(paths)}>
                <Undo2 /> 全部丢弃
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={() => action.run(paths)}>
              {action.icon} 全部{action.label}
            </Button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">无</p>
      ) : (
        <ul className="rounded-md border">
          {entries.map((e) => {
            const code = e[column]
            return (
              <li key={e.path} className="group flex items-center gap-2 border-b px-2 py-1 last:border-b-0 hover:bg-accent/60">
                <span
                  className={cn(
                    'w-10 shrink-0 text-xs',
                    code === 'D' ? 'text-destructive' : code === 'A' || code === '?' ? 'text-success' : 'text-warning',
                  )}
                >
                  {STATUS_LABEL[code] ?? code}
                </span>
                <button type="button" onClick={() => onDiff(e.path)} className="min-w-0 flex-1 truncate rounded px-1 text-left font-mono text-xs hover:underline" title="查看差异">
                  {e.path}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" onClick={() => onDiff(e.path)} aria-label="查看差异">
                      <FileDiff />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>查看差异</TooltipContent>
                </Tooltip>
                {onDiscard && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs" onClick={() => onDiscard([e.path])} aria-label="丢弃">
                        <Undo2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>丢弃修改</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" onClick={() => action.run([e.path])} aria-label={action.label}>
                      {action.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{action.label}</TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PublishCard({ status }: { status: WorkspaceStatus }) {
  const publish = useAdminMutation(
    () => api<{ published: string }>('/api/admin/publish', { method: 'POST' }),
    (r) => `已发布 ${r.published.slice(0, 7)}`,
  )
  const upToDate = status.published === status.head
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>发布 Push</CardTitle>
          <CardDescription>
            读者当前看到 <code>{status.published?.slice(0, 7) ?? '无'}</code>，工作区最新为 <code>{status.head.slice(0, 7)}</code>
          </CardDescription>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={upToDate || publish.isPending}>
              <Rocket /> Push
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>发布当前版本？</AlertDialogTitle>
              <AlertDialogDescription>
                读者将看到提交 {status.head.slice(0, 7)} 的内容。未提交的修改不会被发布。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => publish.mutate(undefined)}>发布</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent>
        {upToDate ? (
          <p className="text-sm text-muted-foreground">已是最新，没有待发布的提交。</p>
        ) : status.unpublished.length === 0 ? (
          <p className="text-sm text-muted-foreground">工作区版本与已发布版本不同（例如回退过），发布后读者将看到工作区版本的内容。</p>
        ) : (
          <ul className="grid gap-1">
            {status.unpublished.map((c) => (
              <li key={c.oid} className="flex items-baseline gap-3 text-sm">
                <code className="text-xs text-muted-foreground">{c.oid.slice(0, 7)}</code>
                <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
