import { type Context, Hono } from 'hono'
import { etag } from 'hono/etag'
import type { SearchResponse, SiteInfo } from '../../shared/types.ts'
import { CommentInput } from '../comments/service.ts'
import { readSiteSettings } from '../content/site-settings.ts'
import { type AppContext, ChapterParams, clientIp, type Env, parseJson } from '../context.ts'
import { RepoError } from '../git/repo.ts'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE } from '../auth/session.ts'

/**
 * Cache policies for public responses. A shared cache (CDN) keeps what these allow; browsers
 * always revalidate (ETag, 304). Public content is the same for every reader, except the
 * compare route when an admin asks: that one is `private`.
 */
export const CACHE = {
  /** Lists and latest-version pages: a publish reaches a shared cache within a minute. */
  live: 'public, max-age=0, s-maxage=60',
  /** A fixed revision or commit never changes. */
  fixed: 'public, max-age=31536000, immutable',
  /** Comments and share links must show a change at once. */
  fresh: 'no-cache',
  /** Depends on who asks: a shared cache must not store it. */
  private: 'private, no-store',
} as const

const cache = (c: Context, policy: string) => c.header('Cache-Control', policy)

export function siteInfo(ctx: AppContext, c: Context): SiteInfo {
  const server = ctx.settings.get()
  const origin = server.baseUrl || new URL(c.req.url).origin
  return {
    settings: readSiteSettings(ctx.db),
    owner: server.owner,
    language: server.language,
    cloneUrl: `${origin}/git/blog.git`,
    fullCloneUrl: `${origin}/git/full/blog.git`,
    publishedCommit: ctx.content.published(),
    pages: ctx.content.listPages(),
    comments: { enabled: ctx.comments.active() },
  }
}

/** Read-only API for readers and third-party frontends. Everything here is published content. */
export function publicRoutes(ctx: AppContext) {
  const app = new Hono<Env>()
  app.use('*', etag())
  app.use('*', async (c, next) => {
    await next()
    if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-cache')
  })

  app.get('/site', (c) => {
    cache(c, CACHE.live)
    return c.json(siteInfo(ctx, c))
  })

  /** ?tags=<key>,<key> keeps articles that carry every listed tag. */
  app.get('/articles', (c) => {
    const tagKeys = (c.req.query('tags') ?? '').split(',').filter(Boolean)
    cache(c, CACHE.live)
    return c.json(ctx.content.listArticles({ tagKeys, series: c.req.query('series') }))
  })

  app.get('/series', (c) => {
    cache(c, CACHE.live)
    return c.json(ctx.content.listSeries())
  })

  app.get('/series/:series', (c) => {
    const s = ctx.content.getSeries(c.req.param('series'))
    if (!s) return c.json({ error: 'series not found' }, 404)
    cache(c, CACHE.live)
    return c.json(s)
  })

  app.get('/tags', (c) => {
    cache(c, CACHE.live)
    return c.json(ctx.content.listTags(false))
  })

  /** Pinned articles, series and tags for the top of the home list. */
  app.get('/pins', (c) => {
    cache(c, CACHE.live)
    return c.json(ctx.content.pinnedItems())
  })

  /** Custom page from _pages/<slug>/, as published. A revision is fixed; the latest version is live. */
  app.get('/pages/:slug', async (c) => {
    const rev = c.req.query('rev')
    const page = await ctx.content.getPage(c.req.param('slug'), rev)
    cache(c, rev ? CACHE.fixed : CACHE.live)
    return c.json(page)
  })

  /** Reader search over published articles, series and tags. Commit messages are searched in the admin API. */
  app.get('/search', (c) => {
    const q = (c.req.query('q') ?? '').trim()
    const body: SearchResponse = {
      articles: ctx.content.search(q),
      series: ctx.content.searchSeries(q),
      tags: ctx.content.searchTags(q),
      fullText: ctx.settings.get().fullText,
    }
    cache(c, CACHE.live)
    return c.json(body)
  })

  /** Bundle: meta + rendered content + history + prev/next in one request. */
  app.get('/articles/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const bundle = await ctx.content.getArticleBundle(p.series, p.chapter, c.req.query('rev'))
    cache(c, CACHE.live)
    return c.json(bundle)
  })

  app.get('/articles/:series/:chapter/meta', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const meta = await ctx.content.getArticleMeta(p.series, p.chapter, c.req.query('rev'))
    cache(c, CACHE.live)
    return c.json(meta)
  })

  app.get('/articles/:series/:chapter/content', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const rev = c.req.query('rev')
    const content = await ctx.content.getArticleContent(p.series, p.chapter, rev)
    cache(c, rev ? CACHE.fixed : CACHE.live)
    return c.json(content)
  })

  app.get('/articles/:series/:chapter/source', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const rev = c.req.query('rev')
    const source = await ctx.content.getArticleSource(p.series, p.chapter, rev)
    cache(c, rev ? CACHE.fixed : CACHE.live)
    return c.json(source)
  })

  /**
   * The visitor link of an article, shared by every reader: null until someone asks for it.
   * POST creates it on first use and returns the same link afterwards.
   */
  app.get('/articles/:series/:chapter/share', (c) => {
    const p = ChapterParams.parse(c.req.param())
    const link = ctx.shares.visitorLink(p.series, p.chapter, false)
    cache(c, CACHE.fresh)
    return c.json({ link: link ? ctx.shares.withUrl(ctx.settings.get(), new URL(c.req.url).origin, link) : null })
  })

  /**
   * Removes the article's visitor link for everyone; the next reader gets a new one. Only the
   * visitor link can be removed this way. Admin links need the admin API.
   */
  app.delete('/articles/:series/:chapter/share', (c) => {
    const p = ChapterParams.parse(c.req.param())
    const ip = clientIp(ctx, c)
    if (ctx.shares.visitorRemoveLimiter.blocked(ip)) return c.json({ error: '操作太频繁，请 10 分钟后再试' }, 429)
    ctx.shares.visitorRemoveLimiter.fail(ip)
    if (!ctx.shares.revokeVisitor(p.series, p.chapter)) return c.json({ error: '分享链接不存在' }, 404)
    cache(c, CACHE.fresh)
    return c.json({ ok: true })
  })

  app.post('/articles/:series/:chapter/share', (c) => {
    const p = ChapterParams.parse(c.req.param())
    const link = ctx.shares.visitorLink(p.series, p.chapter, true)!
    cache(c, CACHE.fresh)
    return c.json(ctx.shares.withUrl(ctx.settings.get(), new URL(c.req.url).origin, link))
  })

  app.get('/articles/:series/:chapter/history', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    const history = await ctx.content.getArticleHistory(p.series, p.chapter)
    cache(c, CACHE.live)
    return c.json(history)
  })

  /** Comments of an article. Empty while the feature is off. */
  app.get('/comments/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    ctx.comments.assertPublished(p.series, p.chapter)
    const list = await ctx.comments.list(p.series, p.chapter)
    cache(c, CACHE.fresh)
    return c.json(list)
  })

  /** Posts a comment. Each attempt counts towards the per-IP limit, accepted or not. */
  app.post('/comments/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    if (!ctx.comments.active()) throw new RepoError('评论未开启', 403)
    ctx.comments.assertPublished(p.series, p.chapter)
    const ip = clientIp(ctx, c)
    if (ctx.comments.postLimiter.blocked(ip)) return c.json({ error: '发表太频繁，请 10 分钟后再试' }, 429)
    ctx.comments.postLimiter.fail(ip)
    const input = await parseJson(c, CommentInput)
    const comment = await ctx.comments.post(p.series, p.chapter, input)
    cache(c, CACHE.fresh)
    return c.json(comment, 201)
  })

  /**
   * Diff between two commits: /api/compare?base=<oid>&head=<oid>[&path=<series>/<n>].
   * Readers may only compare commits of the published history.
   */
  app.get('/compare', async (c) => {
    const admin = ctx.sessions.isValid(getCookie(c, SESSION_COOKIE))
    const path = c.req.query('path') || undefined
    const diff = await ctx.content.compare(c.req.query('base'), c.req.query('head'), { path, admin })
    // Commits never change, so a reader's diff is fixed. An admin may see unpublished commits: never shared.
    cache(c, admin ? CACHE.private : CACHE.fixed)
    return c.json(diff)
  })

  return app
}
