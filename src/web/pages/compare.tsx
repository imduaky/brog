import { useQuery } from '@tanstack/react-query'
import type { CommitInfo, CompareFile, CompareResponse } from '@shared/types'
import { ArrowLeftRight, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { DiffView } from '@/components/diff-view'
import { ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, enc, formatDateTime } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUS: Record<string, { label: string; cls: string }> = {
  A: { label: '新增', cls: 'text-success' },
  M: { label: '修改', cls: 'text-warning' },
  D: { label: '删除', cls: 'text-destructive' },
  R: { label: '重命名', cls: 'text-muted-foreground' },
  T: { label: '类型变更', cls: 'text-muted-foreground' },
}

/** `base...head` or `base..head`. Returns empty strings when the range is malformed. */
function parseRange(range: string): [string, string] {
  const m = /^([0-9a-f]{4,64})\.{2,3}([0-9a-f]{4,64})$/.exec(range)
  return m ? [m[1]!, m[2]!] : ['', '']
}

/**
 * Compare two commits, like GitHub's compare view. Readers see the published
 * history only; the admin route (`admin` prop) can compare any commit.
 */
export default function ComparePage({ admin = false }: { admin?: boolean }) {
  const { range = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const path = params.get('path') || undefined
  const [base, head] = parseRange(range)
  const prefix = admin ? '/admin' : ''
  const [baseInput, setBaseInput] = useState(base)
  const [headInput, setHeadInput] = useState(head)

  const compare = useQuery({
    queryKey: ['compare', base, head, path, admin],
    queryFn: () =>
      api<CompareResponse>(`/api/compare?base=${base}&head=${head}${path ? `&path=${enc(path)}` : ''}`),
    enabled: !!base && !!head,
  })

  const go = (b: string, h: string, p = path) =>
    navigate(`${prefix}/compare/${b}...${h}${p ? `?path=${enc(p)}` : ''}`)

  if (!base || !head) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-muted-foreground">请输入两个提交的 hash 进行对比。</p>
        <RangeForm base={baseInput} head={headInput} setBase={setBaseInput} setHead={setHeadInput} onSubmit={() => go(baseInput.trim(), headInput.trim())} />
      </div>
    )
  }

  return (
    <div className={cn(admin ? 'relative h-full overflow-y-auto' : '')}>
      <div className="mx-auto grid max-w-5xl gap-5 p-6">
        <title>对比 {base.slice(0, 7)}...{head.slice(0, 7)}</title>
        <div className="flex flex-wrap items-end gap-3">
          <RangeForm
            base={baseInput || base}
            head={headInput || head}
            setBase={setBaseInput}
            setHead={setHeadInput}
            onSubmit={() => go(baseInput.trim() || base, headInput.trim() || head)}
          />
          <Button
            variant="outline"
            size="icon"
            className="mb-0.5"
            aria-label="交换两端"
            title="交换两端"
            onClick={() => go(head, base)}
          >
            <ArrowLeftRight />
          </Button>
        </div>

        {compare.isPending ? (
          <Loading />
        ) : compare.isError ? (
          <ErrorState error={compare.error} />
        ) : (
          <Result data={compare.data} path={path} onClearPath={() => setParams({})} />
        )}
      </div>
    </div>
  )
}

function RangeForm({
  base,
  head,
  setBase,
  setHead,
  onSubmit,
}: {
  base: string
  head: string
  setBase: (v: string) => void
  setHead: (v: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="grid gap-1 text-xs text-muted-foreground">
        基准
        <Input className="w-40 font-mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="commit hash" spellCheck={false} />
      </label>
      <span className="pb-2 text-muted-foreground">...</span>
      <label className="grid gap-1 text-xs text-muted-foreground">
        对比
        <Input className="w-40 font-mono" value={head} onChange={(e) => setHead(e.target.value)} placeholder="commit hash" spellCheck={false} />
      </label>
      <Button type="submit" variant="outline">
        对比
      </Button>
    </form>
  )
}

function Result({ data, path, onClearPath }: { data: CompareResponse; path?: string; onClearPath: () => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <CommitCard label="基准" commit={data.base} />
        <CommitCard label="对比" commit={data.head} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {data.files.length} 个文件已更改 · <span className="text-success">+{data.additions}</span>{' '}
          <span className="text-destructive">−{data.deletions}</span>
        </span>
        {path && (
          <Badge variant="outline" className="gap-1 font-mono">
            仅 {path}
            <button type="button" onClick={onClearPath} aria-label="显示全部文件" className="clickable p-0.5">
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>
      {data.truncated && (
        <p className="rounded-sm border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          差异内容超过显示上限，部分文件只显示文件名和行数统计。
        </p>
      )}
      {data.files.length === 0 && <p className="py-10 text-center text-muted-foreground">两个版本之间没有差异</p>}
      <ul className="grid gap-3">
        {data.files.map((f) => (
          <FileDiff key={f.path} file={f} />
        ))}
      </ul>
    </>
  )
}

function CommitCard({ label, commit }: { label: string; commit: CommitInfo }) {
  return (
    <div className="grid gap-1 rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{commit.subject}</span>
      <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <code className="font-mono text-foreground select-all">{commit.oid}</code>
        <span>{commit.author}</span>
        <span>{formatDateTime(commit.time)}</span>
      </span>
    </div>
  )
}

function FileDiff({ file }: { file: CompareFile }) {
  const [open, setOpen] = useState(true)
  const status = STATUS[file.status] ?? { label: file.status, cls: '' }
  return (
    <li className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="clickable flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className={cn('w-16 shrink-0 text-xs', status.cls)}>{status.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</span>
        {file.binary ? (
          <span className="text-xs text-muted-foreground">二进制</span>
        ) : (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-success">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="border-t p-2">
          {file.binary ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">二进制文件，无法显示差异。</p>
          ) : file.patch ? (
            <DiffView diff={file.patch} />
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">差异内容已省略。</p>
          )}
        </div>
      )}
    </li>
  )
}

