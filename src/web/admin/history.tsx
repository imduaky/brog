import { useQuery } from '@tanstack/react-query'
import type { CommitDetail, CommitInfo, ResetMode, WorkspaceStatus } from '@shared/types'
import { GitCompare, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DiffView } from '@/components/diff-view'
import { ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, enc, formatDateTime } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAdminMutation } from './hooks'

const RESET_MODES: { mode: ResetMode; title: string; desc: string }[] = [
  { mode: 'soft', title: 'soft（默认）', desc: '移动分支指针，之后提交的改动保留在暂存区。' },
  { mode: 'mixed', title: 'mixed', desc: '移动分支指针并清空暂存区，改动保留在工作区（未暂存）。' },
  { mode: 'hard', title: 'hard', desc: '移动分支指针，丢弃暂存区和工作区中所有已跟踪文件的改动。不可恢复。' },
]

export default function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const path = params.get('path') ?? ''
  const [detailOid, setDetailOid] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<CommitInfo | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const log = useQuery({
    queryKey: ['admin', 'log', path],
    queryFn: () => api<CommitInfo[]>(`/api/admin/log?limit=300${path ? `&path=${enc(path)}` : ''}`),
  })
  const status = useQuery({ queryKey: ['admin', 'status'], queryFn: () => api<WorkspaceStatus>('/api/admin/status') })
  const revert = useAdminMutation(
    (rev: string) => api<{ oid: string }>('/api/admin/revert', { method: 'POST', json: { rev } }),
    (r) => `已生成反向提交 ${r.oid.slice(0, 7)}`,
  )

  const toggle = (oid: string) =>
    setPicked((p) => (p.includes(oid) ? p.filter((x) => x !== oid) : p.length >= 2 ? [p[1]!, oid] : [...p, oid]))

  // Older commit first, so the diff reads old -> new.
  const compareSelected = () => {
    if (!log.data || picked.length !== 2) return
    const [a, b] = picked.map((oid) => log.data.findIndex((c) => c.oid === oid))
    const [older, newer] = (a! > b! ? [picked[0]!, picked[1]!] : [picked[1]!, picked[0]!])
    navigate(`/admin/compare/${older}...${newer}${path ? `?path=${enc(path)}` : ''}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">提交历史</h1>
          <Button variant="outline" size="sm" disabled={picked.length !== 2} onClick={compareSelected}>
            <GitCompare /> 对比所选{picked.length === 2 ? '' : `（已选 ${picked.length}/2）`}
          </Button>
          <Input
            className="ml-auto max-w-xs"
            placeholder="按路径过滤，例如 系列名/2"
            defaultValue={path}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParams(e.currentTarget.value ? { path: e.currentTarget.value } : {})
            }}
          />
        </div>
        {log.isPending ? (
          <Loading />
        ) : log.isError ? (
          <ErrorState error={log.error} />
        ) : (
          <ul className="rounded-md border">
            {log.data.map((c) => {
              const checked = picked.includes(c.oid)
              return (
                <li
                  key={c.oid}
                  className={cn('group flex items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-accent/50', checked && 'bg-accent/60')}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(c.oid)} aria-label={`选择 ${c.oid.slice(0, 7)} 进行对比`} />
                  <button type="button" onClick={() => setDetailOid(c.oid)} className="min-w-0 flex-1 rounded-sm text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium group-hover:underline">{c.subject}</span>
                      {c.oid === status.data?.head && <Badge variant="outline">当前</Badge>}
                      {c.oid === status.data?.published && <Badge>已发布</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{c.author}</span>
                      <span>{formatDateTime(c.time)}</span>
                    </div>
                  </button>
                  {c.parents[0] ? (
                    <Link
                      to={`/admin/compare/${c.parents[0]}...${c.oid}${path ? `?path=${enc(path)}` : ''}`}
                      title="与上一个提交对比"
                      className="clickable px-2 py-1 font-mono text-xs"
                    >
                      {c.oid.slice(0, 7)}
                    </Link>
                  ) : (
                    <code className="px-2 py-1 font-mono text-xs text-muted-foreground">{c.oid.slice(0, 7)}</code>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setResetTarget(c)} disabled={c.oid === status.data?.head}>
                    <RotateCcw /> 回退到此
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={c.parents.length === 0 || revert.isPending}
                    onClick={() => {
                      if (confirm(`revert「${c.subject}」？将生成一个撤销该提交改动的新提交。`)) revert.mutate(c.oid)
                    }}
                  >
                    <Undo2 /> Revert
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <CommitDialog oid={detailOid} head={status.data?.head} onClose={() => setDetailOid(null)} />
      <ResetDialog target={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  )
}

function CommitDialog({ oid, head, onClose }: { oid: string | null; head?: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['admin', 'commit', oid],
    queryFn: () => api<CommitDetail>(`/api/admin/commits/${oid}`),
    enabled: !!oid,
  })
  const d = detail.data
  return (
    <Dialog open={!!oid} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{d?.subject ?? '提交'}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <code className="font-mono select-all">{oid}</code>
              {d && <span>{d.author}</span>}
              {d && <span>{formatDateTime(d.time)}</span>}
            </div>
          </DialogDescription>
        </DialogHeader>
        {d?.body && <p className="text-sm whitespace-pre-wrap">{d.body}</p>}
        {d && (
          <div className="flex flex-wrap gap-2 text-sm">
            {d.parents[0] && (
              <Link to={`/admin/compare/${d.parents[0]}...${d.oid}`} className="clickable px-2 py-1 font-mono text-xs" onClick={onClose}>
                对比上一个提交 {d.parents[0].slice(0, 7)}
              </Link>
            )}
            {head && head !== d.oid && (
              <Link to={`/admin/compare/${d.oid}...${head}`} className="clickable px-2 py-1 font-mono text-xs" onClick={onClose}>
                对比到当前版本
              </Link>
            )}
          </div>
        )}
        {detail.isPending ? <Loading /> : d && <DiffView diff={d.patch} />}
      </DialogContent>
    </Dialog>
  )
}

function ResetDialog({ target, onClose }: { target: CommitInfo | null; onClose: () => void }) {
  const [mode, setMode] = useState<ResetMode>('soft')
  const reset = useAdminMutation((body: { rev: string; mode: ResetMode }) => api('/api/admin/reset', { method: 'POST', json: body }), '已回退')
  // Commits after the target, which the reset moves away from.
  const affected = useQuery({
    queryKey: ['admin', 'log-since', target?.oid],
    queryFn: () => api<CommitInfo[]>('/api/admin/log?limit=300'),
    enabled: !!target,
    select: (log) => log.slice(0, Math.max(0, log.findIndex((c) => c.oid === target?.oid))),
  })

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>回退（reset）</DialogTitle>
          <DialogDescription>
            回退整个仓库到 <code className="font-mono">{target?.oid.slice(0, 7)}</code> {target?.subject}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup">
          {RESET_MODES.map((m) => (
            <Label
              key={m.mode}
              className={cn(
                'clickable flex cursor-pointer flex-col items-start gap-1 border p-3 font-normal',
                mode === m.mode && 'border-foreground bg-accent',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="reset-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
                {m.title}
              </span>
              <span className="text-xs text-muted-foreground">{m.desc}</span>
            </Label>
          ))}
        </div>
        {affected.data && affected.data.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-muted-foreground">将移出当前版本的 {affected.data.length} 个提交（可能涉及其它文章）：</p>
            <ul className="max-h-32 overflow-y-auto rounded-md border px-3 py-1.5 text-xs">
              {affected.data.map((c) => (
                <li key={c.oid} className="truncate">
                  <code className="text-muted-foreground">{c.oid.slice(0, 7)}</code> {c.subject}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={mode === 'hard' ? 'destructive' : 'default'}
            disabled={reset.isPending}
            onClick={async () => {
              await reset.mutateAsync({ rev: target!.oid, mode })
              onClose()
            }}
          >
            reset --{mode}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
