import { createHash } from 'node:crypto'
import path from 'node:path/posix'
import MarkdownIt from 'markdown-it'
import sharp from 'sharp'
import {
  CONTENT_FILE,
  IMG_DIR,
  isChapterNumber,
  isSeriesSlug,
  JS_DIR,
  META_FILE,
  normalizeRepoPath,
  PAGE_HTML_FILE,
  PAGES_DIR,
  isPageSlug,
} from '../../shared/paths.ts'
import type {
  AdminPin,
  ColorPair,
  PageRef,
  PageResponse,
  PinnedItem,
  SearchSeriesHit,
  TagCount,
  TagRef,
  ArticleBundle,
  ArticleContentResponse,
  ArticleMetaResponse,
  ArticleRef,
  ArticleSummary,
  ChapterMeta,
  CommitInfo,
  CompareResponse,
  ImageUploadResponse,
  SearchArticleHit,
  SearchCommitHit,
  SeriesSummary,
  SourceResponse,
  WorkspaceSeries,
} from '../../shared/types.ts'
import { type DB, getSetting, setSetting } from '../db.ts'
import { type BlogRepo, RepoError } from '../git/repo.ts'
import { headingContextAt, imageBaseName } from '../markdown/heading-context.ts'
import { type RenderResult, renderMarkdown, sandboxDocument } from '../markdown/render.ts'
import { LRU } from '../util/lru.ts'
import { parseChapterMeta, parseSeriesMeta, stringifyMeta } from './meta.ts'
import { readPins } from './pins.ts'
import { catalog, createTag, ensureTags, refsByName, renameTag } from './tags.ts'

const IMAGE_MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}
const TEXT_ASSET = /\.(js|mjs|html|css|json|txt)$/i
const MAX_TEXT_ASSET = 512 * 1024

export const imageMime = (file: string) => IMAGE_MIME[path.extname(file).toLowerCase()]

interface ChapterLocation {
  series: string
  chapter: number
}

/** Splits "<series>/<n>/..." into its parts, or null for files outside a chapter. */
function chapterOf(file: string): ChapterLocation | null {
  const [series, chapter, ...rest] = file.split('/')
  if (!series || !chapter || rest.length === 0 || !isSeriesSlug(series) || !isChapterNumber(chapter)) return null
  return { series, chapter: Number(chapter) }
}

/** "_pages/<slug>/content.md" or "_pages/<slug>/index.html" -> the page, else null. */
function pageOf(file: string): { slug: string; kind: PageRef['kind'] } | null {
  const [top, slug, name, ...rest] = file.split('/')
  if (top !== PAGES_DIR || !slug || rest.length || !isPageSlug(slug)) return null
  if (name === CONTENT_FILE) return { slug, kind: 'markdown' }
  if (name === PAGE_HTML_FILE) return { slug, kind: 'html' }
  return null
}

/** A folder the editor may work on: a chapter or a custom page. */
export function isDocDir(dir: string): boolean {
  const [a, b, ...rest] = dir.split('/')
  if (!a || !b || rest.length) return false
  return a === PAGES_DIR ? isPageSlug(b) : isSeriesSlug(a) && isChapterNumber(b)
}

/** Stored tag names -> catalog refs. A name missing from the catalog gets its name as key (never stored). */
function toRefs(names: string[], refs: Map<string, TagRef>): TagRef[] {
  return names.map((n) => refs.get(n) ?? { key: n, name: n })
}

/** Tags as stored in the published index: {key, name} pairs, frozen at publish time. */
function storedRefs(json: string): TagRef[] {
  return (JSON.parse(json) as (TagRef | string)[]).map((t) => (typeof t === 'string' ? { key: t, name: t } : t))
}

const summaryParser = new MarkdownIt()

/** Search-result markers. The client turns them into <mark> elements, never into HTML. */
export const MARK_START = '\u0002'
export const MARK_END = '\u0003'
const MAX_COMPARE_PATCH = 1_000_000

/** Words of a chapter without markdown syntax, for the search index. */
function plainText(markdown: string): string {
  const out: string[] = []
  for (const t of summaryParser.parse(markdown, {})) {
    if (t.type === 'inline') {
      out.push((t.children ?? []).filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join(''))
    } else if (t.type === 'fence' || t.type === 'code_block') {
      out.push(t.content)
    }
  }
  return out.join('\n')
}

/** A short window of `text` around the first case-insensitive match of `query`, with the match marked. */
function excerpt(text: string, query: string, radius = 36): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat
  const start = Math.max(0, at - radius)
  const end = Math.min(flat.length, at + query.length + radius)
  return [
    start > 0 ? '…' : '',
    flat.slice(start, at),
    MARK_START,
    flat.slice(at, at + query.length),
    MARK_END,
    flat.slice(at + query.length, end),
    end < flat.length ? '…' : '',
  ].join('')
}

interface SearchInput {
  series: string
  chapter: number
  title: string
  tags: string[]
  content: string
  fingerprint: string
}

const likeAny = (cols: string[], n: number) =>
  Array.from({ length: n }, () => `(${cols.map((c) => `instr(lower(${c}), lower(?)) > 0`).join(' OR ')})`).join(' OR ')

function extractSummary(markdown: string): string {
  const tokens = summaryParser.parse(markdown, {})
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type === 'paragraph_open' && tokens[i]!.level === 0) {
      const text = (tokens[i + 1]?.children ?? [])
        .filter((c) => c.type === 'text' || c.type === 'code_inline')
        .map((c) => c.content)
        .join('')
        .trim()
      if (text) return text.length > 200 ? `${text.slice(0, 200)}…` : text
    }
  }
  return ''
}

export class ContentService {
  private readonly renderCache = new LRU<string, RenderResult>(300)

  constructor(
    private readonly repo: BlogRepo,
    private readonly db: DB,
    /** Index chapter bodies (FTS5). When off, search covers titles, tags and summaries. Read on every use. */
    private readonly fullText: () => boolean,
  ) {}

  // ---------------------------------------------------------------- publishing

  published(): string | null {
    return getSetting(this.db, 'published_commit') ?? null
  }

  /** The web "Push": publish the current HEAD. */
  publish(): Promise<string> {
    return this.repo.lock.run(async () => {
      const head = await this.repo.headOid()
      await this.applyPublished(head)
      return head
    })
  }

  async applyPublished(oid: string) {
    setSetting(this.db, 'published_commit', oid)
    await this.repo.setPublishedRefs(oid)
    await this.rebuildIndex(oid)
  }

  /** Rebuilds the index of the published commit, e.g. after full-text search was switched on or off. */
  reindex(): Promise<void> {
    return this.repo.lock.run(async () => {
      const oid = this.published()
      if (oid) await this.rebuildIndex(oid)
    })
  }

  /** Re-derive refs and index from the published commit stored in SQLite. */
  async syncPublished() {
    const oid = this.published()
    if (oid && (await this.repo.resolveCommit(oid))) await this.applyPublished(oid)
  }

  // ---------------------------------------------------------------- index

  private async rebuildIndex(rev: string) {
    const files = (await this.repo.listTree(rev)).filter((e) => e.type === 'blob')
    const chapters = new Map<string, ChapterLocation>()
    const seriesSlugs = new Set<string>()
    for (const f of files) {
      const loc = chapterOf(f.path)
      if (loc && f.path === `${loc.series}/${loc.chapter}/${CONTENT_FILE}`) {
        chapters.set(`${loc.series}/${loc.chapter}`, loc)
        seriesSlugs.add(loc.series)
      }
    }
    const times = await this.chapterTimes(rev)
    const oidOf = new Map(files.map((f) => [f.path, f.oid]))
    const searchInputs: SearchInput[] = []

    const seriesRows: { slug: string; title: string; description: string; cover: string | null }[] = []
    for (const slug of seriesSlugs) {
      const meta = parseSeriesMeta(await this.repo.cat.readText(`${rev}:${slug}/${META_FILE}`), slug)
      const cover = meta.cover ? await this.assetUrlAt(rev, path.join(slug, meta.cover)) : null
      seriesRows.push({ slug, title: meta.title, description: meta.description, cover })
    }
    // Tags are stored by name in the index, as they are in meta.yaml.
    const articleRows: (Omit<ArticleSummary, 'seriesTitle' | 'tags'> & { tags: string[] })[] = []
    for (const [dir, loc] of chapters) {
      const meta = parseChapterMeta(await this.repo.cat.readText(`${rev}:${dir}/${META_FILE}`), `${loc.series} ${loc.chapter}`)
      const content = (await this.repo.cat.readText(`${rev}:${dir}/${CONTENT_FILE}`)) ?? ''
      const t = times.get(dir) ?? { created: 0, updated: 0 }
      articleRows.push({
        ...loc,
        title: meta.title,
        // The card text: the hand-written preview, else the summary, else the first paragraph.
        summary: meta.preview?.text ?? meta.summary ?? extractSummary(content),
        tags: meta.tags,
        theme: meta.preview?.theme ?? null,
        cover: meta.cover ? await this.assetUrlAt(rev, path.join(dir, meta.cover)) : null,
        createdAt: t.created,
        updatedAt: t.updated,
      })
      searchInputs.push({
        ...loc,
        title: meta.title,
        tags: meta.tags,
        content,
        fingerprint: `${oidOf.get(`${dir}/${CONTENT_FILE}`)}:${oidOf.get(`${dir}/${META_FILE}`) ?? ''}`,
      })
    }

    // A page folder with both files is a Markdown page.
    const pageKinds = new Map<string, PageRef['kind']>()
    for (const f of files) {
      const page = pageOf(f.path)
      if (page && pageKinds.get(page.slug) !== 'markdown') pageKinds.set(page.slug, page.kind)
    }
    const pageRows: PageRef[] = []
    for (const [slug, kind] of pageKinds) {
      const meta = parseSeriesMeta(await this.repo.cat.readText(`${rev}:${PAGES_DIR}/${slug}/${META_FILE}`), slug)
      pageRows.push({ slug, title: meta.title, kind })
    }

    // Names are registered first, so every stored tag has a catalog key.
    ensureTags(this.db, articleRows.flatMap((a) => a.tags))
    const refsOf = refsByName(this.db)

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM series_index').run()
      this.db.prepare('DELETE FROM article_index').run()
      this.db.prepare('DELETE FROM page_index').run()
      const insP = this.db.prepare('INSERT INTO page_index (slug, title, kind) VALUES (?, ?, ?)')
      for (const p of pageRows) insP.run(p.slug, p.title, p.kind)
      const insS = this.db.prepare(
        'INSERT INTO series_index (slug, title, description, cover, sort) VALUES (?, ?, ?, ?, ?)',
      )
      seriesRows.sort((a, b) => a.slug.localeCompare(b.slug)).forEach((s, i) => insS.run(s.slug, s.title, s.description, s.cover, i))
      const insA = this.db.prepare(
        'INSERT INTO article_index (series, chapter, title, summary, tags, cover, created_at, updated_at, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const a of articleRows) {
        const tags = toRefs(a.tags, refsOf)
        insA.run(
          a.series,
          a.chapter,
          a.title,
          a.summary,
          JSON.stringify(tags),
          a.cover,
          a.createdAt,
          a.updatedAt,
          a.theme ? JSON.stringify(a.theme) : null,
        )
      }
    })()
    this.updateSearch(searchInputs)
    this.renderCache.clear()
  }

  /**
   * Re-index only chapters whose content or meta blob changed since the last publish,
   * and drop chapters that no longer exist. Publishing a one-line fix costs one chapter.
   */
  private updateSearch(inputs: SearchInput[]) {
    const db = this.db
    if (!this.fullText()) {
      db.transaction(() => {
        db.prepare('DELETE FROM search_fts').run()
        db.prepare('DELETE FROM search_state').run()
      })()
      return
    }
    const known = new Map(
      (db.prepare('SELECT series, chapter, fingerprint FROM search_state').all() as {
        series: string
        chapter: number
        fingerprint: string
      }[]).map((r) => [`${r.series}/${r.chapter}`, r]),
    )
    const current = new Set(inputs.map((i) => `${i.series}/${i.chapter}`))
    const delFts = db.prepare('DELETE FROM search_fts WHERE series = ? AND chapter = ?')
    const delState = db.prepare('DELETE FROM search_state WHERE series = ? AND chapter = ?')
    db.transaction(() => {
      for (const [key, row] of known) {
        if (current.has(key)) continue
        delFts.run(row.series, row.chapter)
        delState.run(row.series, row.chapter)
      }
      for (const i of inputs) {
        const key = `${i.series}/${i.chapter}`
        if (known.get(key)?.fingerprint === i.fingerprint) continue
        delFts.run(i.series, i.chapter)
        db.prepare('INSERT INTO search_fts (series, chapter, title, tags, body) VALUES (?, ?, ?, ?, ?)').run(
          i.series,
          i.chapter,
          i.title,
          i.tags.join(' '),
          plainText(i.content),
        )
        db.prepare(
          `INSERT INTO search_state (series, chapter, fingerprint) VALUES (?, ?, ?)
           ON CONFLICT(series, chapter) DO UPDATE SET fingerprint = excluded.fingerprint`,
        ).run(i.series, i.chapter, i.fingerprint)
      }
    })()
  }

  /** First and last commit time of every chapter folder, from one pass over the history. */
  private async chapterTimes(rev: string): Promise<Map<string, { created: number; updated: number }>> {
    const out = await this.repo.gitText(['log', '--format=%x1e%at', '--name-only', '--no-renames', rev])
    const times = new Map<string, { created: number; updated: number }>()
    for (const record of out.split('\x1e').filter(Boolean)) {
      const [timeLine, ...files] = record.split('\n')
      const time = Number(timeLine) * 1000
      for (const f of files) {
        const loc = f && chapterOf(f)
        if (!loc) continue
        const key = `${loc.series}/${loc.chapter}`
        const t = times.get(key)
        // log runs newest -> oldest
        if (!t) times.set(key, { created: time, updated: time })
        else t.created = time
      }
    }
    return times
  }

  /** Articles, newest first. `tagKeys` keeps articles that carry every given tag (AND). */
  listArticles(filter: { tagKeys?: string[]; series?: string } = {}): ArticleSummary[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, s.title AS series_title FROM article_index a
         JOIN series_index s ON s.slug = a.series
         ORDER BY a.created_at DESC, a.series, a.chapter`,
      )
      .all() as {
      series: string
      chapter: number
      title: string
      summary: string
      tags: string
      cover: string | null
      created_at: number
      updated_at: number
      series_title: string
      theme: string | null
    }[]
    const keys = filter.tagKeys ?? []
    return rows
      .map((r) => ({
        series: r.series,
        chapter: r.chapter,
        title: r.title,
        seriesTitle: r.series_title,
        summary: r.summary,
        tags: storedRefs(r.tags),
        theme: r.theme ? (JSON.parse(r.theme) as ColorPair) : null,
        cover: r.cover,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
      .filter((a) => keys.every((k) => a.tags.some((t) => t.key === k)))
      .filter((a) => !filter.series || a.series === filter.series)
  }

  listSeries(): SeriesSummary[] {
    const series = this.db.prepare('SELECT * FROM series_index ORDER BY sort').all() as {
      slug: string
      title: string
      description: string
      cover: string | null
    }[]
    const articles = this.listArticles()
    return series.map((s) => {
      const chapters = articles.filter((a) => a.series === s.slug).sort((a, b) => a.chapter - b.chapter)
      return {
        slug: s.slug,
        title: s.title,
        description: s.description,
        cover: s.cover,
        chapters: chapters.map(({ series, chapter, title }) => ({ series, chapter, title })),
        updatedAt: Math.max(0, ...chapters.map((c) => c.updatedAt)),
      }
    })
  }

  getSeries(slug: string): SeriesSummary | null {
    return this.listSeries().find((s) => s.slug === slug) ?? null
  }

  /**
   * Tags with usage counts from the published index, matched by key. Readers see the
   * names as published and only tags in use; the admin also gets the live catalog.
   */
  listTags(includeUnused: boolean): TagCount[] {
    const used = new Map<string, TagCount>()
    for (const a of this.listArticles()) {
      for (const t of a.tags) {
        const hit = used.get(t.key) ?? { ...t, count: 0 }
        hit.count++
        used.set(t.key, hit)
      }
    }
    if (!includeUnused) return [...used.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return catalog(this.db)
      .map((t) => ({ ...t, count: used.get(t.key)?.count ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  /** Adds a tag to the predefined catalog. It is attached to articles through their meta. */
  addTag(name: string): TagRef {
    return createTag(this.db, name)
  }

  /**
   * Renames a tag: updates the catalog and rewrites the name in every workspace
   * meta.yaml that uses it. The changes are workspace edits, committed like any other.
   */
  renameTag(key: string, name: string): Promise<TagRef> {
    return this.repo.lock.run(async () => {
      const { before, after } = renameTag(this.db, key, name)
      if (before.name === after.name) return after
      for (const file of await this.repo.listWorking()) {
        const loc = chapterOf(file)
        if (!loc || file !== `${loc.series}/${loc.chapter}/${META_FILE}`) continue
        const meta = parseChapterMeta(await this.readWorkingText(file), '')
        if (!meta.tags.includes(before.name)) continue
        const tags = meta.tags.map((t) => (t === before.name ? after.name : t))
        await this.repo.writeWorking(file, stringifyMeta({ ...meta, tags: [...new Set(tags)] }))
      }
      return after
    })
  }

  /** Catalog tags for the admin editor (name and key), including unused ones. */
  tagCatalog(): TagRef[] {
    return catalog(this.db)
  }

  // ---------------------------------------------------------------- pins

  /** Pinned items that are published, in the admin's order. Unpublished or deleted targets are skipped. */
  pinnedItems(): PinnedItem[] {
    const articles = new Map(this.listArticles().map((a) => [`${a.series}/${a.chapter}`, a]))
    const series = new Map(this.listSeries().map((s) => [s.slug, s]))
    const tags = new Map(this.listTags(false).map((t) => [t.key, t]))
    const out: PinnedItem[] = []
    for (const p of readPins(this.db)) {
      if (p.kind === 'article' && articles.has(p.key)) out.push({ kind: 'article', key: p.key, article: articles.get(p.key)! })
      else if (p.kind === 'series' && series.has(p.key)) out.push({ kind: 'series', key: p.key, series: series.get(p.key)! })
      else if (p.kind === 'tag' && tags.has(p.key)) out.push({ kind: 'tag', key: p.key, tag: tags.get(p.key)! })
    }
    return out
  }

  /** Every pin with its title, null when the target is not published. */
  adminPins(): AdminPin[] {
    const resolved = new Map(this.pinnedItems().map((p) => [`${p.kind}:${p.key}`, p]))
    const names = new Map(catalog(this.db).map((t) => [t.key, t.name]))
    return readPins(this.db).map((p) => {
      const r = resolved.get(`${p.kind}:${p.key}`)
      const title = !r
        ? null
        : r.kind === 'article'
          ? r.article.title
          : r.kind === 'series'
            ? r.series.title
            : (names.get(r.key) ?? r.tag.name)
      return { ...p, title }
    })
  }

  // ---------------------------------------------------------------- custom pages

  /** Published custom pages. */
  listPages(): PageRef[] {
    return this.db.prepare('SELECT slug, title, kind FROM page_index ORDER BY slug').all() as PageRef[]
  }

  async getPage(slug: string, rev?: string): Promise<PageResponse> {
    const oid = await this.resolveReaderRev(rev)
    if (!isPageSlug(slug)) throw new RepoError('page not found', 404)
    const dir = `${PAGES_DIR}/${slug}`
    const title = parseSeriesMeta(await this.repo.cat.readText(`${oid}:${dir}/${META_FILE}`), slug).title
    const result = await this.renderDirAt(oid, dir, slug)
    if (result) return { slug, title, kind: 'markdown', html: result.html, toc: result.toc, rev: oid }
    const html = await this.repo.cat.readText(`${oid}:${dir}/${PAGE_HTML_FILE}`)
    if (html === null) throw new RepoError('page not found', 404)
    return { slug, title, kind: 'html', html: sandboxDocument(html), toc: [], rev: oid }
  }

  // ---------------------------------------------------------------- search

  /**
   * Article search over published chapters. Queries of 3+ characters use the
   * trigram index (MATCH is O(matches), not O(text)); 2-character queries fall
   * back to a substring scan, which is still cheap at blog scale.
   */
  search(q: string, limit = 30): SearchArticleHit[] {
    const query = q.trim().slice(0, 100)
    if (query.length < 2) return []
    if (!this.fullText()) return this.searchMeta(query, limit)
    return query.length >= 3 ? this.searchFts(query, limit) : this.searchShort(query, limit)
  }

  private searchFts(query: string, limit: number): SearchArticleHit[] {
    const phrase = `"${query.replace(/"/g, '""')}"`
    const rows = this.db
      .prepare(
        `SELECT f.series, f.chapter, a.title, a.tags, s.title AS series_title,
                snippet(search_fts, -1, ?, ?, '…', 12) AS snip
         FROM search_fts f
         JOIN article_index a ON a.series = f.series AND a.chapter = f.chapter
         JOIN series_index s ON s.slug = f.series
         WHERE search_fts MATCH ?
         ORDER BY bm25(search_fts, 0, 0, 10, 4, 1)
         LIMIT ?`,
      )
      .all(MARK_START, MARK_END, phrase, limit) as {
      series: string
      chapter: number
      title: string
      tags: string
      series_title: string
      snip: string
    }[]
    return rows.map((r) => ({
      series: r.series,
      chapter: r.chapter,
      title: r.title,
      seriesTitle: r.series_title,
      tags: storedRefs(r.tags),
      snippet: r.snip,
    }))
  }

  private searchShort(query: string, limit: number): SearchArticleHit[] {
    const rows = this.db
      .prepare(
        `SELECT f.series, f.chapter, a.title, a.tags, a.summary, s.title AS series_title, f.body
         FROM search_fts f
         JOIN article_index a ON a.series = f.series AND a.chapter = f.chapter
         JOIN series_index s ON s.slug = f.series
         WHERE ${likeAny(['f.title', 'f.tags', 'f.body'], 1)}
         ORDER BY a.created_at DESC
         LIMIT ?`,
      )
      .all(query, query, query, limit) as {
      series: string
      chapter: number
      title: string
      tags: string
      summary: string
      series_title: string
      body: string
    }[]
    return rows.map((r) => ({
      series: r.series,
      chapter: r.chapter,
      title: r.title,
      seriesTitle: r.series_title,
      tags: storedRefs(r.tags),
      snippet: excerpt(r.body.toLowerCase().includes(query.toLowerCase()) ? r.body : r.summary, query),
    }))
  }

  /** Used when full-text indexing is off: titles, tags and summaries only. */
  private searchMeta(query: string, limit: number): SearchArticleHit[] {
    const rows = this.db
      .prepare(
        `SELECT a.series, a.chapter, a.title, a.tags, a.summary, s.title AS series_title
         FROM article_index a JOIN series_index s ON s.slug = a.series
         WHERE ${likeAny(['a.title', 'a.summary', 'a.tags'], 1)}
         ORDER BY a.created_at DESC
         LIMIT ?`,
      )
      .all(query, query, query, limit) as {
      series: string
      chapter: number
      title: string
      tags: string
      summary: string
      series_title: string
    }[]
    return rows.map((r) => ({
      series: r.series,
      chapter: r.chapter,
      title: r.title,
      seriesTitle: r.series_title,
      tags: storedRefs(r.tags),
      snippet: excerpt(r.title.toLowerCase().includes(query.toLowerCase()) ? r.summary : r.summary || r.title, query),
    }))
  }

  /** Published series whose title or description contains the query. */
  searchSeries(q: string): SearchSeriesHit[] {
    const query = q.trim().slice(0, 100).toLowerCase()
    if (query.length < 2) return []
    return this.listSeries()
      .filter((s) => s.title.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
      .slice(0, 10)
      .map((s) => ({ slug: s.slug, title: s.title, description: s.description, count: s.chapters.length }))
  }

  /** Tags in use whose name contains the query. */
  searchTags(q: string): TagCount[] {
    const query = q.trim().slice(0, 100).toLowerCase()
    if (query.length < 1) return []
    return this.listTags(false)
      .filter((t) => t.name.toLowerCase().includes(query))
      .slice(0, 20)
  }

  /** Commit messages matching `query`, with the articles each one touched. */
  async searchCommits(rev: string, query: string): Promise<SearchCommitHit[]> {
    const q = query.trim().slice(0, 100)
    if (q.length < 2) return []
    const hits = await this.repo.searchCommits(rev, q, 30)
    const out: SearchCommitHit[] = []
    for (const h of hits) {
      const seen = new Set<string>()
      const articles: ArticleRef[] = []
      for (const file of h.paths) {
        const loc = chapterOf(file)
        if (!loc) continue
        const key = `${loc.series}/${loc.chapter}`
        if (seen.has(key)) continue
        seen.add(key)
        const meta = parseChapterMeta(await this.repo.cat.readText(`${h.oid}:${key}/${META_FILE}`), '')
        articles.push({ series: loc.series, chapter: loc.chapter, title: meta.title || key })
        if (articles.length >= 5) break
      }
      const { paths: _paths, ...info } = h
      out.push({ ...info, articles })
    }
    return out
  }

  // ---------------------------------------------------------------- reading articles

  /** Readers may only see the published commit or its ancestors. */
  async resolveReaderRev(rev?: string): Promise<string> {
    const published = this.published()
    if (!published) throw new RepoError('nothing published yet', 404)
    if (!rev) return published
    if (!/^[0-9a-f]{4,64}$/.test(rev)) throw new RepoError('invalid revision', 400)
    const oid = await this.repo.resolveCommit(rev)
    if (!oid || !(await this.repo.isAncestor(oid, published))) throw new RepoError('revision not found', 404)
    return oid
  }

  async getArticleMeta(series: string, chapter: number, rev?: string): Promise<ArticleMetaResponse> {
    const oid = await this.resolveReaderRev(rev)
    const dir = `${series}/${chapter}`
    const metaText = await this.repo.cat.readText(`${oid}:${dir}/${META_FILE}`)
    if (metaText === null && (await this.repo.cat.read(`${oid}:${dir}/${CONTENT_FILE}`)) === null) {
      throw new RepoError('article not found', 404)
    }
    const meta = parseChapterMeta(metaText, `${series} ${chapter}`)
    const seriesMeta = parseSeriesMeta(await this.repo.cat.readText(`${oid}:${series}/${META_FILE}`), series)
    const row = this.db
      .prepare('SELECT created_at, updated_at FROM article_index WHERE series = ? AND chapter = ?')
      .get(series, chapter) as { created_at: number; updated_at: number } | undefined
    return {
      series: { slug: series, title: seriesMeta.title },
      chapter,
      meta: {
        ...meta,
        tags: await this.metaTagRefs(oid, series, chapter, meta.tags),
        coverUrl: meta.cover ? await this.assetUrlAt(oid, path.join(dir, meta.cover)) : null,
      },
      rev: oid,
      createdAt: row?.created_at ?? 0,
      updatedAt: row?.updated_at ?? 0,
    }
  }

  /** Tags of the published version come from the index (frozen at publish). Older revisions use live names. */
  private async metaTagRefs(oid: string, series: string, chapter: number, names: string[]): Promise<TagRef[]> {
    if (oid === this.published()) {
      const row = this.db.prepare('SELECT tags FROM article_index WHERE series = ? AND chapter = ?').get(series, chapter) as
        | { tags: string }
        | undefined
      if (row) return storedRefs(row.tags)
    }
    return toRefs(names, refsByName(this.db))
  }

  async getArticleContent(series: string, chapter: number, rev?: string): Promise<ArticleContentResponse> {
    const oid = await this.resolveReaderRev(rev)
    const result = await this.renderAt(oid, series, chapter)
    if (!result) throw new RepoError('article not found', 404)
    return { html: result.html, toc: result.toc, rev: oid }
  }

  /** Raw markdown of a chapter, as published (or at a published revision). */
  async getArticleSource(series: string, chapter: number, rev?: string): Promise<SourceResponse> {
    const oid = await this.resolveReaderRev(rev)
    const text = await this.repo.cat.readText(`${oid}:${series}/${chapter}/${CONTENT_FILE}`)
    if (text === null) throw new RepoError('article not found', 404)
    return { text, rev: oid }
  }

  /** Commit endpoints of a comparison: any commit for the admin, published history only for readers. */
  async resolveRange(rev: string | undefined, admin: boolean): Promise<string> {
    if (admin) {
      if (!rev || !/^[0-9a-f]{4,64}$/.test(rev)) throw new RepoError('invalid revision', 400)
      const oid = await this.repo.resolveCommit(rev)
      if (!oid) throw new RepoError('revision not found', 404)
      return oid
    }
    if (!rev) throw new RepoError('revision is required', 400)
    return this.resolveReaderRev(rev)
  }

  async compare(
    baseRev: string | undefined,
    headRev: string | undefined,
    opts: { path?: string; admin: boolean },
  ): Promise<CompareResponse> {
    if (opts.path !== undefined && !normalizeRepoPath(opts.path)) throw new RepoError('invalid path')
    const base = await this.resolveRange(baseRev, opts.admin)
    const head = await this.resolveRange(headRev, opts.admin)
    const [baseInfo] = await this.repo.log({ rev: base, limit: 1 })
    const [headInfo] = await this.repo.log({ rev: head, limit: 1 })
    const diff = await this.repo.compare(base, head, { path: opts.path, maxPatchBytes: MAX_COMPARE_PATCH })
    return { base: baseInfo!, head: headInfo!, ...diff }
  }

  async getArticleHistory(series: string, chapter: number): Promise<CommitInfo[]> {
    const published = this.published()
    if (!published) return []
    return this.repo.log({ rev: published, path: `${series}/${chapter}`, limit: 200 })
  }

  async getArticleBundle(series: string, chapter: number, rev?: string): Promise<ArticleBundle> {
    const meta = await this.getArticleMeta(series, chapter, rev)
    const [content, history] = await Promise.all([
      this.getArticleContent(series, chapter, meta.rev),
      this.getArticleHistory(series, chapter),
    ])
    const siblings = this.getSeries(series)?.chapters ?? []
    const i = siblings.findIndex((c) => c.chapter === chapter)
    const pick = (c: ArticleRef | undefined) => c ?? null
    return {
      ...meta,
      content,
      history,
      prev: i > 0 ? pick(siblings[i - 1]) : null,
      next: i >= 0 ? pick(siblings[i + 1]) : null,
    }
  }

  private renderAt(rev: string, series: string, chapter: number): Promise<RenderResult | null> {
    return this.renderDirAt(rev, `${series}/${chapter}`, `${chapter}`)
  }

  /** Renders <dir>/content.md at a revision, with the folder's images and scripts. */
  private async renderDirAt(rev: string, dir: string, docId: string): Promise<RenderResult | null> {
    const entries = (await this.repo.listTree(rev, dir)).filter((e) => e.type === 'blob')
    const content = entries.find((e) => e.path === `${dir}/${CONTENT_FILE}`)
    if (!content) return null
    const key = createHash('sha1')
      .update(entries.map((e) => `${e.path}\0${e.oid}`).join('\n'))
      .digest('hex')
    const cached = this.renderCache.get(key)
    if (cached) return cached
    const assets = new Map<string, string>()
    const texts = new Map<string, string>()
    for (const e of entries) {
      if (imageMime(e.path)) assets.set(e.path, await this.assetUrlForBlob(e.oid, e.path))
      else if (TEXT_ASSET.test(e.path)) {
        const obj = await this.repo.cat.read(e.oid)
        if (obj && obj.data.length <= MAX_TEXT_ASSET) texts.set(e.path, obj.data.toString('utf8'))
      }
    }
    const source = (await this.repo.cat.readText(content.oid)) ?? ''
    const result = await renderMarkdown(source, {
      baseDir: dir,
      resolveAsset: (p) => assets.get(p) ?? null,
      readText: (p) => texts.get(p) ?? null,
      docId,
    })
    this.renderCache.set(key, result)
    return result
  }

  // ---------------------------------------------------------------- images

  private async assetUrlAt(rev: string, repoPath: string): Promise<string | null> {
    if (!imageMime(repoPath)) return null
    const obj = await this.repo.cat.read(`${rev}:${repoPath}`)
    return obj && obj.type === 'blob' ? this.assetUrlForBlob(obj.oid, repoPath) : null
  }

  /** Maps a git blob to its public /images/{hash} URL, registering it on first use. */
  async assetUrlForBlob(blobOid: string, repoPath: string): Promise<string> {
    const row = this.db.prepare('SELECT hash FROM images WHERE blob_oid = ?').get(blobOid) as { hash: string } | undefined
    if (row) return `/images/${row.hash}`
    const obj = await this.repo.cat.read(blobOid)
    if (!obj) throw new RepoError('blob not found', 404)
    return `/images/${this.registerImage(obj.data, blobOid, repoPath)}`
  }

  private registerImage(data: Buffer, blobOid: string, repoPath: string): string {
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 32)
    this.db
      .prepare(
        'INSERT OR IGNORE INTO images (hash, blob_oid, path, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(hash, blobOid, repoPath, imageMime(repoPath) ?? 'application/octet-stream', data.length, Date.now())
    return hash
  }

  async readImage(hash: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!/^[0-9a-f]{32}$/.test(hash)) return null
    const row = this.db.prepare('SELECT blob_oid, mime FROM images WHERE hash = ?').get(hash) as
      | { blob_oid: string; mime: string }
      | undefined
    if (!row) return null
    const obj = await this.repo.cat.read(row.blob_oid)
    return obj ? { data: obj.data, mime: row.mime } : null
  }

  /**
   * Pasted image: convert to webp, name it after the heading at the cursor
   * ("开始-开始第一步_1.webp"), store it in the chapter's img/ folder.
   */
  uploadImage(input: {
    /** Chapter or page folder */
    dir: string
    data: Buffer
    markdown: string
    offset: number
  }): Promise<ImageUploadResponse> {
    return this.repo.lock.run(async () => {
      const dir = input.dir
      if (!isDocDir(dir) || !(await this.repo.existsWorking(`${dir}/${CONTENT_FILE}`))) throw new RepoError('article not found', 404)
      const webp = await sharp(input.data, { animated: true })
        .rotate()
        .webp({ quality: 82 })
        .toBuffer()
        .catch(() => {
          throw new RepoError('not a valid image', 400)
        })
      const meta = parseChapterMeta((await this.repo.readWorking(`${dir}/${META_FILE}`))?.toString('utf8') ?? null, '')
      const ctx = headingContextAt(input.markdown, input.offset)
      const base = imageBaseName(ctx, meta.title || dir.split('/')[0]!)
      let index = ctx.imageIndex
      let rel = `${IMG_DIR}/${base}_${index}.webp`
      while (await this.repo.existsWorking(`${dir}/${rel}`)) rel = `${IMG_DIR}/${base}_${++index}.webp`
      await this.repo.writeWorking(`${dir}/${rel}`, webp)
      const blobOid = (await this.repo.gitText(['hash-object', '-w', '--', `${dir}/${rel}`])).trim()
      const hash = this.registerImage(webp, blobOid, `${dir}/${rel}`)
      return { path: rel, url: `/images/${hash}`, hash }
    })
  }

  // ---------------------------------------------------------------- workspace (admin)

  async workspaceTree(): Promise<WorkspaceSeries[]> {
    const files = await this.repo.listWorking()
    const dirty = new Set((await this.repo.status()).map((s) => s.path))
    const series = new Map<string, WorkspaceSeries>()
    for (const f of files) {
      const loc = chapterOf(f)
      if (!loc || f !== `${loc.series}/${loc.chapter}/${CONTENT_FILE}`) continue
      let s = series.get(loc.series)
      if (!s) {
        const meta = parseSeriesMeta(await this.readWorkingText(`${loc.series}/${META_FILE}`), loc.series)
        s = { slug: loc.series, title: meta.title, chapters: [], dirty: false }
        series.set(loc.series, s)
      }
      const dir = `${loc.series}/${loc.chapter}`
      const meta = parseChapterMeta(await this.readWorkingText(`${dir}/${META_FILE}`), `${loc.chapter}`)
      s.chapters.push({ chapter: loc.chapter, title: meta.title, dirty: false })
    }
    for (const p of dirty) {
      const loc = chapterOf(p)
      const [slug] = p.split('/')
      const s = series.get(slug ?? '')
      if (!s) continue
      s.dirty = true
      const c = loc && s.chapters.find((x) => x.chapter === loc.chapter)
      if (c) c.dirty = true
    }
    const list = [...series.values()]
    for (const s of list) s.chapters.sort((a, b) => a.chapter - b.chapter)
    return list.sort((a, b) => a.slug.localeCompare(b.slug))
  }

  private async readWorkingText(file: string): Promise<string | null> {
    return (await this.repo.readWorking(file))?.toString('utf8') ?? null
  }

  /** Creates the next chapter of a series (and the series itself when new). */
  createChapter(input: { series: string; seriesTitle?: string; title: string; tags?: string[] }): Promise<ArticleRef> {
    return this.repo.lock.run(async () => {
      if (!isSeriesSlug(input.series)) throw new RepoError('invalid series name')
      const files = await this.repo.listWorking(input.series).catch(() => [])
      if (!(await this.repo.existsWorking(`${input.series}/${META_FILE}`))) {
        await this.repo.writeWorking(
          `${input.series}/${META_FILE}`,
          stringifyMeta({ title: input.seriesTitle || input.series, description: '' }),
        )
      }
      const used = files.map((f) => chapterOf(f)?.chapter ?? 0)
      const chapter = Math.max(0, ...used) + 1
      const dir = `${input.series}/${chapter}`
      const meta: ChapterMeta = { title: input.title, tags: input.tags ?? [] }
      ensureTags(this.db, meta.tags)
      await this.repo.writeWorking(`${dir}/${META_FILE}`, stringifyMeta(meta))
      await this.repo.writeWorking(`${dir}/${CONTENT_FILE}`, `# ${input.title}\n\n`)
      return { series: input.series, chapter, title: input.title }
    })
  }

  /** Live preview of the editor content, resolving assets from the work tree. */
  async preview(dir: string, source: string): Promise<RenderResult> {
    if (!isDocDir(dir)) throw new RepoError('invalid folder')
    const files = await this.repo.listWorking(dir)
    const texts = new Map<string, string>()
    for (const f of files.filter((f) => f.startsWith(`${dir}/${JS_DIR}/`) || TEXT_ASSET.test(f))) {
      const buf = await this.repo.readWorking(f)
      if (buf && buf.length <= MAX_TEXT_ASSET) texts.set(f, buf.toString('utf8'))
    }
    const fileSet = new Set(files)
    return renderMarkdown(source, {
      baseDir: dir,
      resolveAsset: (p) =>
        fileSet.has(p) && imageMime(p) ? `/api/admin/workspace/raw?path=${encodeURIComponent(p)}` : null,
      readText: (p) => texts.get(p) ?? null,
      docId: dir.split('/')[1]!,
    })
  }

  /** Custom pages in the work tree, with uncommitted-change markers. */
  async workspacePages(): Promise<(PageRef & { dirty: boolean })[]> {
    const files = await this.repo.listWorking(PAGES_DIR).catch(() => [] as string[])
    const dirty = (await this.repo.status()).map((s) => s.path)
    const kinds = new Map<string, PageRef['kind']>()
    for (const f of files) {
      const page = pageOf(f)
      if (page && kinds.get(page.slug) !== 'markdown') kinds.set(page.slug, page.kind)
    }
    const out: (PageRef & { dirty: boolean })[] = []
    for (const [slug, kind] of kinds) {
      const dir = `${PAGES_DIR}/${slug}`
      const meta = parseSeriesMeta(await this.readWorkingText(`${dir}/${META_FILE}`), slug)
      out.push({ slug, title: meta.title, kind, dirty: dirty.some((p) => p.startsWith(`${dir}/`)) })
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug))
  }

  /** Creates _pages/<slug>/ with a title and an empty Markdown or HTML file. */
  createPage(input: { slug: string; title: string; kind: PageRef['kind'] }): Promise<PageRef> {
    return this.repo.lock.run(async () => {
      if (!isPageSlug(input.slug)) throw new RepoError('invalid page name')
      const dir = `${PAGES_DIR}/${input.slug}`
      if ((await this.repo.listWorking(dir).catch(() => [])).length) throw new RepoError('page already exists', 409)
      await this.repo.writeWorking(`${dir}/${META_FILE}`, stringifyMeta({ title: input.title, description: '' }))
      if (input.kind === 'markdown') await this.repo.writeWorking(`${dir}/${CONTENT_FILE}`, `# ${input.title}\n\n`)
      else
        await this.repo.writeWorking(
          `${dir}/${PAGE_HTML_FILE}`,
          `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${input.title.replace(/[<&]/g, '')}</title>\n</head>\n<body>\n\n</body>\n</html>\n`,
        )
      return { slug: input.slug, title: input.title, kind: input.kind }
    })
  }
}

