import { type Context, Hono } from 'hono'
import { etag } from 'hono/etag'
import type { SiteInfo } from '../../shared/types.ts'
import { readSiteSettings } from '../content/site-settings.ts'
import { type AppContext, ChapterParams, type Env } from '../context.ts'
import { currentSession } from './auth.ts'

export function siteInfo(ctx: AppContext, c: Context): SiteInfo {
  const origin = ctx.config.server.baseUrl?.replace(/\/$/, '') ?? new URL(c.req.url).origin
  return {
    settings: readSiteSettings(ctx.db, ctx.config.site),
    owner: ctx.config.site.owner,
    language: ctx.config.site.language,
    cloneUrl: `${origin}/git/blog.git`,
    fullCloneUrl: `${origin}/git/full/blog.git`,
    publishedCommit: ctx.content.published(),
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

  app.get('/site', (c) => c.json(siteInfo(ctx, c)))

  /** ?tags=<key>,<key> keeps articles that carry every listed tag. */
  app.get('/articles', (c) => {
    const tagKeys = (c.req.query('tags') ?? '').split(',').filter(Boolean)
    return c.json(ctx.content.listArticles({ tagKeys, series: c.req.query('series') }))
  })

  app.get('/series', (c) => c.json(ctx.content.listSeries()))

  app.get('/series/:series', (c) => {
    const s = ctx.content.getSeries(c.req.param('series'))
    return s ? c.json(s) : c.json({ error: 'series not found' }, 404)
  })

  app.get('/tags', (c) => c.json(ctx.content.listTags(false)))

  /**
   * Search. Articles come from the published index. Commits come from the
   * published history for readers, and from the full history for the admin.
   */
  app.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    const scope = c.req.query('scope') ?? 'all'
    const admin = currentSession(ctx, c).admin
    const articles = scope !== 'commits' ? ctx.content.search(q) : []
    let commits: Awaited<ReturnType<typeof ctx.content.searchCommits>> = []
    if (scope !== 'articles') {
      const rev = admin ? 'HEAD' : ctx.content.published()
      if (rev) commits = await ctx.content.searchCommits(rev, q)
    }
    return c.json({ articles, commits, fullText: ctx.config.search.fullText })
  })

  /** Bundle: meta + rendered content + history + prev/next in one request. */
  app.get('/articles/:series/:chapter', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    return c.json(await ctx.content.getArticleBundle(p.series, p.chapter, c.req.query('rev')))
  })

  app.get('/articles/:series/:chapter/meta', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    return c.json(await ctx.content.getArticleMeta(p.series, p.chapter, c.req.query('rev')))
  })

  app.get('/articles/:series/:chapter/content', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    return c.json(await ctx.content.getArticleContent(p.series, p.chapter, c.req.query('rev')))
  })

  app.get('/articles/:series/:chapter/source', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    return c.json(await ctx.content.getArticleSource(p.series, p.chapter, c.req.query('rev')))
  })

  app.get('/articles/:series/:chapter/history', async (c) => {
    const p = ChapterParams.parse(c.req.param())
    return c.json(await ctx.content.getArticleHistory(p.series, p.chapter))
  })

  /**
   * Diff between two commits: /api/compare?base=<oid>&head=<oid>[&path=<series>/<n>].
   * Readers may only compare commits of the published history.
   */
  app.get('/compare', async (c) => {
    const admin = currentSession(ctx, c).admin
    const path = c.req.query('path') || undefined
    return c.json(
      await ctx.content.compare(c.req.query('base'), c.req.query('head'), { path, admin }),
    )
  })

  return app
}
