import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { ChapterMeta, ImageUploadResponse, PageRef, SeriesMeta, TagCount, TocItem, WorkspaceStatus } from '@shared/types'
import { ArrowLeft, Check, Columns2, Eye, GitCommitHorizontal, Loader2, PencilLine, Plus, Settings2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { MarkdownView } from '@/components/markdown-view'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useTheme } from '@/hooks/use-theme'
import { ColorPairField } from '@/components/color-field'
import { THEME_PRESETS, type ColorPair } from '@shared/color'
import { api, assetUrl, enc } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAdminMutation } from './hooks'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type Layout = 'edit' | 'split' | 'preview'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** What the editor works on: a chapter, or a custom page under _pages/. */
type Doc =
  | { type: 'chapter'; series: string; chapter: number; dir: string; file: 'content.md'; kind: 'markdown' }
  | { type: 'page'; slug: string; dir: string; file: string; kind: PageRef['kind'] }

export default function EditorPage() {
  const { series = '', chapter: chapterParam = '' } = useParams()
  const chapter = Number(chapterParam)
  const doc: Doc = { type: 'chapter', series, chapter, dir: `${series}/${chapter}`, file: 'content.md', kind: 'markdown' }
  return <EditorLoader doc={doc} />
}

export function PageEditorPage() {
  const { slug = '' } = useParams()
  const pages = useQuery({ queryKey: ['admin', 'pages'], queryFn: () => api<(PageRef & { dirty: boolean })[]>('/api/admin/pages') })
  if (pages.isPending) return <Loading />
  if (pages.isError) return <ErrorState error={pages.error} />
  const page = pages.data.find((p) => p.slug === slug)
  if (!page) return <ErrorState error={new Error('页面不存在')} />
  const doc: Doc = {
    type: 'page',
    slug,
    dir: `_pages/${slug}`,
    file: page.kind === 'html' ? 'index.html' : 'content.md',
    kind: page.kind,
  }
  return <EditorLoader doc={doc} />
}

function EditorLoader({ doc }: { doc: Doc }) {
  const contentPath = `${doc.dir}/${doc.file}`
  const file = useQuery({
    queryKey: ['admin', 'file', contentPath],
    queryFn: () => api<{ exists: boolean; content: string }>(`/api/admin/file?path=${enc(contentPath)}`),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: 'always',
  })
  if (file.isPending) return <Loading />
  if (file.isError) return <ErrorState error={file.error} />
  if (!file.data.exists) return <ErrorState error={new Error('文章不存在')} />
  return <Editor key={contentPath} target={doc} initial={file.data.content} />
}

type LanguageSupport = Awaited<ReturnType<(typeof languages)[number]['load']>>

/** CodeMirror language for an HTML page, loaded on demand. */
function useHtmlLanguage(enabled: boolean) {
  const [lang, setLang] = useState<LanguageSupport | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void languages
      .find((l) => l.extensions.includes('html'))
      ?.load()
      .then((l) => !cancelled && setLang(l))
    return () => {
      cancelled = true
    }
  }, [enabled])
  return lang
}

function Editor({ target, initial }: { target: Doc; initial: string }) {
  const { dir, kind } = target
  const contentPath = `${dir}/${target.file}`
  const [doc, setDoc] = useState(initial)
  const [save, setSave] = useState<SaveState>('saved')
  const [layout, setLayout] = useState<Layout>('split')
  const [metaOpen, setMetaOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [preview, setPreview] = useState<{ html: string; toc: TocItem[] } | null>(null)
  const savedDoc = useRef(initial)
  // Latest text, readable from callbacks without making them depend on every keystroke.
  const docRef = useRef(initial)
  const editor = useRef<ReactCodeMirrorRef>(null)
  const previewBox = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()

  // ------------------------------------------------------------ autosave
  // Stable (depends only on the path): the CodeMirror extensions below are built from it,
  // and rebuilding them on every keystroke reconfigures the editor.
  const saveNow = useCallback(async () => {
    const content = docRef.current
    if (content === savedDoc.current) {
      setSave('saved')
      return
    }
    setSave('saving')
    try {
      await api('/api/admin/file', { method: 'PUT', json: { path: contentPath, content } })
      savedDoc.current = content
      setSave(docRef.current === content ? 'saved' : 'dirty')
    } catch (err) {
      setSave('error')
      toast.error(`保存失败：${err instanceof Error ? err.message : err}`)
    }
  }, [contentPath])

  const debouncedDoc = useDebounced(doc, 800)
  useEffect(() => {
    if (debouncedDoc !== savedDoc.current) void saveNow()
  }, [debouncedDoc, saveNow])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (save !== 'saved') e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [save])

  // ------------------------------------------------------------ live preview
  // Rendered in every layout so the pane is ready when it is shown. The previous
  // result stays on screen until the new one arrives (no spinner, no height flash).
  const previewDoc = useDebounced(doc, 300)
  useEffect(() => {
    // An HTML page previews as itself in a sandboxed frame; nothing to render on the server.
    if (kind === 'html') return
    let cancelled = false
    api<{ html: string; toc: TocItem[] }>('/api/admin/preview', { method: 'POST', json: { dir, content: previewDoc } })
      .then((r) => !cancelled && setPreview(r))
      .catch((err) => !cancelled && setPreview({ html: `<p style="color:red">${String(err)}</p>`, toc: [] }))
    return () => {
      cancelled = true
    }
  }, [previewDoc, dir, kind])

  // ------------------------------------------------------------ scroll sync (editor -> preview)
  // Preview blocks carry data-line (their source line). The editor's top visible line
  // is mapped to a preview position, interpolated between the two neighbouring blocks.
  const syncPreview = useCallback(() => {
    const view = editor.current?.view
    const box = previewBox.current
    if (!view || !box) return
    const topLine = view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number
    const boxTop = box.getBoundingClientRect().top
    const blocks = [...box.querySelectorAll<HTMLElement>('[data-line]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ line: Number(el.dataset.line), y: el.getBoundingClientRect().top - boxTop + box.scrollTop }))
      .sort((a, b) => a.line - b.line)
    if (blocks.length === 0) return
    let lo = blocks[0]!
    let hi: typeof lo | undefined
    for (const b of blocks) {
      if (b.line <= topLine) lo = b
      else {
        hi = b
        break
      }
    }
    let y = lo.y
    if (hi && hi.line > lo.line) {
      const t = Math.min(1, Math.max(0, (topLine - lo.line) / (hi.line - lo.line)))
      y = lo.y + t * (hi.y - lo.y)
    }
    box.scrollTop = Math.max(0, y - 16)
  }, [])

  // Re-align after each preview update, so the preview follows the editor while text changes.
  useLayoutEffect(() => {
    if (layout === 'split') syncPreview()
  }, [preview, layout, syncPreview])
  // The editor extension below calls this through a ref, so it never needs rebuilding.
  const syncRef = useRef(syncPreview)
  useEffect(() => {
    syncRef.current = syncPreview
  }, [syncPreview])

  // ------------------------------------------------------------ paste / drop images
  const upload = useCallback(
    async (view: EditorView, files: File[]) => {
      for (const f of files) {
        const pos = view.state.selection.main.head
        const placeholder = `![上传中 ${Math.random().toString(36).slice(2, 8)}…]()`
        const form = new FormData()
        form.set('file', f)
        form.set('dir', dir)
        form.set('markdown', view.state.doc.toString())
        form.set('offset', String(pos))
        view.dispatch({ changes: { from: pos, insert: placeholder }, selection: { anchor: pos + placeholder.length } })
        try {
          const r = await api<ImageUploadResponse>('/api/admin/images', { method: 'POST', body: form })
          const at = view.state.doc.toString().indexOf(placeholder)
          if (at >= 0) view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: `![](${r.path})` } })
          toast.success(`已上传 ${r.path}`)
        } catch (err) {
          const at = view.state.doc.toString().indexOf(placeholder)
          if (at >= 0) view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: '' } })
          toast.error(`图片上传失败：${err instanceof Error ? err.message : err}`)
        }
      }
    },
    [dir],
  )

  const htmlLanguage = useHtmlLanguage(kind === 'html')
  // Built once per document. Depends only on stable callbacks, so typing never reconfigures the editor.
  // (An HTML page adds its language once, when it has loaded.)
  const extensions = useMemo(
    () => [
      kind === 'html' ? (htmlLanguage ?? []) : markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      // Scroll events go to the view's own scroller, so the listener lives on the view.
      ViewPlugin.define((view) => {
        let frame = 0
        const onScroll = () => {
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0
              syncRef.current()
            })
        }
        view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
        return {
          destroy() {
            view.scrollDOM.removeEventListener('scroll', onScroll)
            if (frame) cancelAnimationFrame(frame)
          },
        }
      }),
      EditorView.domEventHandlers({
        paste(event, view) {
          // Pasted images become Markdown; an HTML page has no place for them.
          if (kind === 'html') return false
          const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          event.preventDefault()
          void upload(view, files)
          return true
        },
        drop(event, view) {
          if (kind === 'html') return false
          const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          event.preventDefault()
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos !== null) view.dispatch({ selection: { anchor: pos } })
          void upload(view, files)
          return true
        },
        keydown(event) {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault()
            void saveNow()
            return true
          }
          return false
        },
      }),
    ],
    [upload, saveNow, kind, htmlLanguage],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin">
            <ArrowLeft /> 工作区
          </Link>
        </Button>
        <span className="truncate font-mono text-xs text-muted-foreground">{contentPath}</span>
        <SaveIndicator state={save} />
        <div className="ml-auto flex items-center gap-2">
          <Tabs value={layout} onValueChange={(v) => setLayout(v as Layout)}>
            <TabsList>
              <TabsTrigger value="edit" aria-label="仅编辑">
                <PencilLine />
              </TabsTrigger>
              <TabsTrigger value="split" aria-label="分栏">
                <Columns2 />
              </TabsTrigger>
              <TabsTrigger value="preview" aria-label="仅预览">
                <Eye />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)}>
            <Settings2 /> {target.type === 'chapter' ? '文章信息' : '页面信息'}
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await saveNow()
              setCommitOpen(true)
            }}
          >
            <GitCommitHorizontal /> 提交
          </Button>
        </div>
      </div>
      <div className={cn('grid min-h-0 flex-1', layout === 'split' && 'grid-cols-2')}>
        <div className={cn('min-h-0 overflow-hidden', layout === 'preview' && 'hidden', layout === 'split' && 'border-r')}>
          <CodeMirror
            ref={editor}
            value={doc}
            onChange={(v) => {
              docRef.current = v
              setDoc(v)
              setSave('dirty')
            }}
            extensions={extensions}
            theme={resolved}
            height="100%"
            className="h-full text-[14px] [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono"
            basicSetup={{ foldGutter: false, highlightActiveLineGutter: true }}
            autoFocus
          />
        </div>
        {layout !== 'edit' &&
          (kind === 'html' ? (
            <iframe title="预览" sandbox="allow-scripts" srcDoc={previewDoc} className="block h-full w-full bg-background" />
          ) : (
            <div ref={previewBox} className="relative min-h-0 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-8 py-6">{preview && <MarkdownView html={preview.html} />}</div>
            </div>
          ))}
      </div>
      {target.type === 'chapter' ? (
        <MetaSheet series={target.series} chapter={target.chapter} open={metaOpen} onOpenChange={setMetaOpen} />
      ) : (
        <PageMetaDialog slug={target.slug} open={metaOpen} onOpenChange={setMetaOpen} />
      )}
      <CommitDialog
        paths={(p) => p.startsWith(`${dir}/`) || (target.type === 'chapter' && p === `${target.series}/meta.yaml`)}
        what={target.type === 'chapter' ? '这篇文章' : '这个页面'}
        open={commitOpen}
        onOpenChange={setCommitOpen}
      />
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    saved: { icon: <Check className="size-3.5" />, text: '已保存到工作区', cls: 'text-muted-foreground' },
    dirty: { icon: <span className="size-1.5 rounded-full bg-warning" />, text: '未保存', cls: 'text-muted-foreground' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: '保存中', cls: 'text-muted-foreground' },
    error: { icon: <TriangleAlert className="size-3.5" />, text: '保存失败', cls: 'text-destructive' },
  }[state]
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', map.cls)}>
      {map.icon}
      {map.text}
    </span>
  )
}

/**
 * Tags of this article, chosen from the predefined catalog. A name that is not in the
 * catalog yet is added to it first, so every tag an article uses is in the catalog.
 */
function TagPicker({
  catalog,
  selected,
  onChange,
  onCreated,
}: {
  catalog: TagCount[]
  selected: string[]
  onChange: (tags: string[]) => void
  onCreated: () => void
}) {
  const [draft, setDraft] = useState('')
  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name])
  const known = new Set(catalog.map((t) => t.name))
  const add = async () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    if (!known.has(name)) {
      try {
        await api('/api/admin/tags', { method: 'POST', json: { name } })
        onCreated()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        return
      }
    }
    if (!selected.includes(name)) onChange([...selected, name])
  }
  // Selected names that are no longer in the catalog (renamed elsewhere) stay visible, so nothing is lost silently.
  const extra = selected.filter((n) => !known.has(n))
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {catalog.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={selected.includes(t.name)}
            onClick={() => toggle(t.name)}
            className="chip flex h-8 items-center gap-2 border px-2.5 text-sm"
          >
            {t.name}
          </button>
        ))}
        {extra.map((n) => (
          <button key={n} type="button" aria-pressed onClick={() => toggle(n)} className="chip flex h-8 items-center gap-2 border border-dashed px-2.5 text-sm">
            {n}
          </button>
        ))}
        {catalog.length === 0 && extra.length === 0 && <p className="text-sm text-muted-foreground">还没有标签，在下面输入一个新增。</p>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="新增标签" maxLength={30} aria-label="新增标签" />
        <Button type="submit" variant="outline" disabled={!draft.trim()}>
          <Plus /> 添加
        </Button>
      </form>
    </div>
  )
}

function MetaSheet({
  series,
  chapter,
  open,
  onOpenChange,
}: {
  series: string
  chapter: number
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const dir = `${series}/${chapter}`
  const qc = useQueryClient()
  const meta = useQuery({
    queryKey: ['admin', 'meta', dir],
    queryFn: () => api<ChapterMeta>(`/api/admin/meta/${enc(series)}/${chapter}`),
    enabled: open,
  })
  const seriesMeta = useQuery({
    queryKey: ['admin', 'series-meta', series],
    queryFn: () => api<SeriesMeta>(`/api/admin/series-meta/${enc(series)}`),
    enabled: open,
  })
  const images = useQuery({
    queryKey: ['admin', 'files', `${dir}/img`],
    queryFn: () => api<string[]>(`/api/admin/files?prefix=${enc(`${dir}/img`)}`),
    enabled: open,
  })
  const catalog = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => api<TagCount[]>('/api/admin/tags'),
    enabled: open,
  })
  const [form, setForm] = useState({
    title: '',
    tags: [] as string[],
    cover: '',
    summary: '',
    previewText: '',
    previewTheme: null as ColorPair | null,
  })
  const [sForm, setSForm] = useState({ title: '', description: '' })
  useEffect(() => {
    if (meta.data)
      setForm({
        title: meta.data.title,
        tags: meta.data.tags,
        cover: meta.data.cover ?? '',
        summary: meta.data.summary ?? '',
        previewText: meta.data.preview?.text ?? '',
        previewTheme: meta.data.preview?.theme ?? null,
      })
  }, [meta.data])
  useEffect(() => {
    if (seriesMeta.data) setSForm({ title: seriesMeta.data.title, description: seriesMeta.data.description })
  }, [seriesMeta.data])

  const saveMeta = useAdminMutation(async () => {
    await api(`/api/admin/meta/${enc(series)}/${chapter}`, {
      method: 'PUT',
      json: {
        title: form.title.trim(),
        tags: form.tags,
        cover: form.cover || undefined,
        summary: form.summary.trim() || undefined,
        preview: {
          text: form.previewText.trim() || undefined,
          theme: form.previewTheme ?? undefined,
        },
      },
    })
    await api(`/api/admin/series-meta/${enc(series)}`, {
      method: 'PUT',
      json: { title: sForm.title.trim() || series, description: sForm.description, cover: seriesMeta.data?.cover },
    })
  }, '已保存到工作区')

  const coverOptions = (images.data ?? []).map((p) => p.slice(dir.length + 1))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>文章信息</SheetTitle>
          <SheetDescription>修改后需要提交并发布，读者才会看到。</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <div className="grid gap-2">
            <Label htmlFor="m-title">标题</Label>
            <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>标签</Label>
            <TagPicker
              catalog={catalog.data ?? []}
              selected={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
              onCreated={() => void qc.invalidateQueries({ queryKey: ['admin', 'tags'] })}
            />
          </div>
          <div className="grid gap-2">
            <Label>封面（可选）</Label>
            <Select value={form.cover || '__none'} onValueChange={(v) => setForm({ ...form, cover: v === '__none' ? '' : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">无封面</SelectItem>
                {coverOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.cover && (
              <img src={assetUrl(`/api/admin/workspace/raw?path=${enc(`${dir}/${form.cover}`)}`)} alt="" className="max-h-40 rounded-md border object-cover" />
            )}
            <p className="text-xs text-muted-foreground">先在正文中粘贴图片，再在这里选为封面。</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="m-summary">摘要（用于搜索与页面描述，留空取第一段）</Label>
            <Textarea id="m-summary" rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <Separator />
          <div className="grid gap-4">
            <div>
              <h3 className="text-sm font-semibold">首页预览</h3>
              <p className="text-xs text-muted-foreground">首页卡片上显示的内容，与正文和摘要无关，可以手动设置。</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-preview">预览文字</Label>
              <Textarea
                id="m-preview"
                rows={2}
                maxLength={300}
                value={form.previewText}
                onChange={(e) => setForm({ ...form, previewText: e.target.value })}
                placeholder="留空时使用摘要，再没有则使用正文第一段"
              />
            </div>
            <div className="grid gap-3">
              <span className="text-sm">卡片颜色</span>
              {form.previewTheme ? (
                <>
                  <ColorPairField
                    idPrefix="m-theme"
                    label="亮色与暗色"
                    value={form.previewTheme}
                    onChange={(previewTheme) => setForm({ ...form, previewTheme })}
                    presets={THEME_PRESETS}
                  />
                  <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setForm({ ...form, previewTheme: null })}>
                    清除颜色
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setForm({ ...form, previewTheme: THEME_PRESETS[0]!.pair })}>
                  设置卡片颜色
                </Button>
              )}
            </div>
          </div>
          <Separator />
          <div className="grid gap-2">
            <Label htmlFor="s-title">合集标题</Label>
            <Input id="s-title" value={sForm.title} onChange={(e) => setSForm({ ...sForm, title: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-desc">合集简介</Label>
            <Textarea id="s-desc" rows={2} value={sForm.description} onChange={(e) => setSForm({ ...sForm, description: e.target.value })} />
          </div>
        </div>
        <SheetFooter>
          <Button onClick={() => saveMeta.mutate(undefined)} disabled={saveMeta.isPending || !form.title.trim()}>
            保存
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function CommitDialog({
  paths: belongs,
  what,
  open,
  onOpenChange,
}: {
  /** Which changed files belong to the document being edited */
  paths: (path: string) => boolean
  what: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [message, setMessage] = useState('')
  const status = useQuery({
    queryKey: ['admin', 'status'],
    queryFn: () => api<WorkspaceStatus>('/api/admin/status'),
    enabled: open,
  })
  const paths = (status.data?.changes ?? []).map((c) => c.path).filter(belongs)

  const commit = useAdminMutation(
    async () => {
      await api('/api/admin/stage', { method: 'POST', json: { paths } })
      return api<{ oid: string }>('/api/admin/commit', { method: 'POST', json: { message } })
    },
    (r) => `已提交 ${r.oid.slice(0, 7)}，在工作区页面 Push 发布`,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await commit.mutateAsync(undefined)
            setMessage('')
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>提交{what}</DialogTitle>
            <DialogDescription>暂存并提交{what}的所有修改（{paths.length} 个文件）。其它文件的修改请在工作区页面处理。</DialogDescription>
          </DialogHeader>
          {paths.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs">
              {paths.map((p) => (
                <li key={p} className="truncate">
                  {p}
                </li>
              ))}
            </ul>
          )}
          <Textarea autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="提交说明" rows={3} />
          <DialogFooter>
            <Button type="submit" disabled={!message.trim() || paths.length === 0 || commit.isPending}>
              提交 Commit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Title of a custom page (_pages/<slug>/meta.yaml). Shown in the browser tab and the admin lists. */
function PageMetaDialog({ slug, open, onOpenChange }: { slug: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const meta = useQuery({
    queryKey: ['admin', 'page-meta', slug],
    queryFn: () => api<{ title: string }>(`/api/admin/page-meta/${enc(slug)}`),
    enabled: open,
  })
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (meta.data) setTitle(meta.data.title)
  }, [meta.data])
  const save = useAdminMutation(
    () => api(`/api/admin/page-meta/${enc(slug)}`, { method: 'PUT', json: { title: title.trim() } }),
    '已保存到工作区',
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await save.mutateAsync(undefined)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>页面信息</DialogTitle>
            <DialogDescription>页面地址为 /p/{slug}。修改后需要提交并发布，读者才会看到。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pm-title">标题</Label>
            <Input id="pm-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || save.isPending}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
