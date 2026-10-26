import { useQuery } from '@tanstack/react-query'
import type { ArticleBundle, ArticleRef } from '@shared/types'
import { ChevronLeft, ChevronRight, FileText, GitCommitVertical, History, List } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CommitTree } from '@/components/commit-tree'
import { Comments } from '@/components/comments'
import { ShareButton } from '@/components/share'
import { MarkdownView } from '@/components/markdown-view'
import { PanelHeader } from '@/components/panel-header'
import { PinButton } from '@/components/pin-button'
import { ReaderTools, type ToolItem } from '@/components/reader-tools'
import { ResizeHandle } from '@/components/resize-handle'
import { ErrorState, Loading } from '@/components/states'
import { Toc } from '@/components/toc'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMedia } from '@/hooks/use-media'
import { useSite } from '@/hooks/use-site'
import { useTheme } from '@/hooks/use-theme'
import { api, articlePath, assetUrl, enc, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type PanelId = 'toc' | 'history'

interface Prefs {
  open: Record<PanelId, boolean>
  widths: Record<PanelId, number>
  toolsMinimized: boolean
}

const DEFAULT_PREFS: Prefs = {
  open: { toc: true, history: true },
  widths: { toc: 240, history: 280 },
  toolsMinimized: false,
}
const WIDTH_LIMITS: Record<PanelId, [number, number]> = {
  toc: [160, 420],
  history: [200, 460],
}
const PREFS_KEY = 'brog-reader-panels'
/** Width of the drag handle that belongs to each panel slot. */
const HANDLE_PX = 8
/** Reader columns need this much room; below it the panels open as sheets. */
const WIDE_QUERY = '(min-width: 1280px)'

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>
      // Only known panels are kept (the source panel became its own page).
      return {
        open: { toc: p.open?.toc ?? DEFAULT_PREFS.open.toc, history: p.open?.history ?? DEFAULT_PREFS.open.history },
        widths: { toc: p.widths?.toc ?? DEFAULT_PREFS.widths.toc, history: p.widths?.history ?? DEFAULT_PREFS.widths.history },
        toolsMinimized: p.toolsMinimized ?? DEFAULT_PREFS.toolsMinimized,
      }
    }
  } catch {}
  return structuredClone(DEFAULT_PREFS)
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v))

export default function ArticlePage() {
  const { series = '', chapter = '' } = useParams()
  const [params] = useSearchParams()
  const rev = params.get('rev')
  const wide = useMedia(WIDE_QUERY)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [sheet, setSheet] = useState<PanelId | null>(null)
  const [dragging, setDragging] = useState<PanelId | null>(null)
  // The preview color of the article tints its header on the reader too. Hooks stay above the early returns.
  const { resolved } = useTheme()
  const site = useSite()

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {}
  }, [prefs])

  const article = useQuery({
    queryKey: ['article', series, chapter, rev],
    queryFn: () => api<ArticleBundle>(`/api/articles/${enc(series)}/${chapter}${rev ? `?rev=${enc(rev)}` : ''}`),
    placeholderData: (prev) => prev,
  })

  if (article.isPending) return <Loading />
  if (article.isError) return <ErrorState error={article.error} />
  const a = article.data
  const base = articlePath(series, Number(chapter))
  const isOld = !!rev && a.rev !== a.history[0]?.oid
  const chapterDir = `${series}/${chapter}`
  const sourceHref = `${base}/source${rev ? `?rev=${enc(rev)}` : ''}`

  const tint = a.meta.preview?.theme?.[resolved]
  const isOpen = (id: PanelId) => (wide ? prefs.open[id] : sheet === id)
  const toggle = (id: PanelId) =>
    wide ? setPrefs((p) => ({ ...p, open: { ...p.open, [id]: !p.open[id] } })) : setSheet((s) => (s === id ? null : id))
  const hide = (id: PanelId) => setPrefs((p) => ({ ...p, open: { ...p.open, [id]: false } }))
  const resize = (id: PanelId, dx: number) =>
    setPrefs((p) => ({ ...p, widths: { ...p.widths, [id]: clamp(p.widths[id] + dx, WIDTH_LIMITS[id]) } }))
  const resetWidth = (id: PanelId) => setPrefs((p) => ({ ...p, widths: { ...p.widths, [id]: DEFAULT_PREFS.widths[id] } }))

  const tools: ToolItem[] = [
    { key: 'toc', label: '目录', icon: <List />, active: isOpen('toc'), onClick: () => toggle('toc') },
    { key: 'source', label: '原文', icon: <FileText />, to: sourceHref },
    { key: 'history', label: '历史', icon: <History />, active: isOpen('history'), onClick: () => toggle('history') },
  ]

  const hrefFor = (_c: unknown, i: number) => (i === 0 ? base : `${base}?rev=${a.history[i]!.oid}`)
  // Each commit compares with the version before it (the next row down) for this article.
  const compareHref = (c: { oid: string }, i: number) => {
    const older = a.history[i + 1]
    return older ? `/compare/${older.oid}...${c.oid}?path=${enc(chapterDir)}` : null
  }

  const tocBody = <Toc items={a.content.toc} />
  const historyBody = <CommitTree commits={a.history} current={a.rev} hrefFor={hrefFor} compareHref={compareHref} />

  // Wide layout: each panel is a sticky slot whose width animates. The slot keeps the
  // panel's own width inside, so content does not squeeze while it slides.
  const slot = (id: PanelId, side: 'left' | 'right', title: string, body: ReactNode) => {
    const open = prefs.open[id]
    const width = prefs.widths[id]
    const handle = (
      <ResizeHandle
        label={`调整${title}宽度`}
        onDrag={(dx) => resize(id, side === 'left' ? dx : -dx)}
        onReset={() => resetWidth(id)}
        onDragStateChange={(d) => setDragging(d ? id : null)}
      />
    )
    const inner = (
      <div className="flex min-h-0 min-w-0 flex-col" style={{ width }}>
        <PanelHeader title={title} side={side} onHide={() => hide(id)} />
        <div className="relative min-h-0 overflow-y-auto pr-1 [scrollbar-width:thin]">{body}</div>
      </div>
    )
    return (
      <div
        className="panel-slot sticky flex shrink-0 self-start overflow-clip py-6"
        style={{
          top: 'var(--header-h)',
          maxHeight: 'calc(100svh - var(--header-h))',
          width: open ? width + HANDLE_PX : 0,
          opacity: open ? 1 : 0,
        }}
        data-dragging={dragging === id}
        aria-hidden={!open}
        inert={!open}
      >
        {side === 'left' ? (
          <>
            {inner}
            {handle}
          </>
        ) : (
          <>
            {handle}
            {inner}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start">
      <title>{a.meta.title}</title>

      {wide && slot('toc', 'left', '目录', tocBody)}

      <article className="min-w-0 flex-1 py-6">
        <div className="mx-auto max-w-3xl">
          {isOld && (
            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-4 py-2 text-sm">
              <GitCommitVertical className="size-4" />
              正在阅读历史版本 <code className="font-mono">{a.rev.slice(0, 7)}</code>
              <Link to={base} className="clickable ml-auto px-2 py-0.5 font-medium">
                返回最新版本
              </Link>
            </div>
          )}
          <header
            className={cn('mb-8', tint && 'rounded-lg p-6')}
            style={tint ? { backgroundColor: `color-mix(in oklch, ${tint} 30%, var(--background))` } : undefined}
          >
            <Link to={`/s/${enc(series)}`} className="clickable -ml-2 px-2 py-0.5 text-sm text-muted-foreground">
              {a.series.title} · 第 {a.chapter} 篇
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{a.meta.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span>发布于 {formatDate(a.createdAt)}</span>
              {a.updatedAt !== a.createdAt && <span>更新于 {formatDate(a.updatedAt)}</span>}
              {a.meta.tags.map((t) => (
                <Badge key={t.key} variant="secondary" asChild>
                  <Link to={`/tags?tags=${enc(t.key)}`} className="hover:bg-accent">
                    {t.name}
                  </Link>
                </Badge>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <Link to={sourceHref} className="clickable inline-flex items-center gap-1 px-2 py-0.5">
                  <FileText className="size-3.5" />
                  原文
                </Link>
                <PinButton kind="article" pinKey={chapterDir} className="h-7 px-2 text-muted-foreground" />
                <ShareButton series={series} chapter={Number(chapter)} className="h-7 px-2 text-muted-foreground" />
              </span>
            </div>
          </header>
          {a.meta.coverUrl && <img src={assetUrl(a.meta.coverUrl)} alt="" className="mb-8 max-h-96 w-full object-cover" />}
          <MarkdownView html={a.content.html} />
          {site.data?.comments.enabled && <Comments series={series} chapter={Number(chapter)} />}
          <nav className={cn('mt-16 grid gap-3 border-t pt-6 sm:grid-cols-2')}>
            {a.prev ? <PrevNext article={a.prev} dir="prev" /> : <span />}
            {a.next && <PrevNext article={a.next} dir="next" />}
          </nav>
        </div>
      </article>

      {wide && slot('history', 'right', '历史', historyBody)}

      {!wide && (
        <>
          <Sheet open={sheet === 'toc'} onOpenChange={(o) => !o && setSheet(null)}>
            <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto p-4">
              <SheetHeader className="p-0">
                <SheetTitle>目录</SheetTitle>
              </SheetHeader>
              {tocBody}
            </SheetContent>
          </Sheet>
          <Sheet open={sheet === 'history'} onOpenChange={(o) => !o && setSheet(null)}>
            <SheetContent side="right" className="w-[85vw] max-w-sm overflow-y-auto p-4">
              <SheetHeader className="p-0">
                <SheetTitle>历史</SheetTitle>
              </SheetHeader>
              {historyBody}
            </SheetContent>
          </Sheet>
        </>
      )}

      <ReaderTools
        minimized={prefs.toolsMinimized}
        onMinimizedChange={(v) => setPrefs((p) => ({ ...p, toolsMinimized: v }))}
        tools={tools}
      />
    </div>
  )
}

function PrevNext({ article, dir }: { article: ArticleRef; dir: 'prev' | 'next' }) {
  return (
    <Link
      to={articlePath(article.series, article.chapter)}
      className={cn(
        'clickable flex items-center gap-2 rounded-lg border bg-card p-3 hover:border-foreground/25',
        dir === 'next' && 'justify-end text-right sm:col-start-2',
      )}
    >
      {dir === 'prev' && <ChevronLeft className="size-4 shrink-0" />}
      <span>
        <span className="block text-xs text-muted-foreground">{dir === 'prev' ? '上一篇' : '下一篇'}</span>
        {article.title}
      </span>
      {dir === 'next' && <ChevronRight className="size-4 shrink-0" />}
    </Link>
  )
}
