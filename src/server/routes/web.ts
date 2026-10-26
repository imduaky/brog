import { readFileSync } from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { readSiteSettings } from '../content/site-settings.ts'
import { type AppContext, type Env } from '../context.ts'

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/**
 * Serves the built SPA. HTML responses get title/description/og tags injected
 * for article pages so links unfurl and crawlers see real metadata.
 */
export function webRoutes(ctx: AppContext) {
  const app = new Hono<Env>()
  const root = ctx.startup.webDist
  let template: string | null = null
  const loadTemplate = () => {
    if (template === null || process.env.NODE_ENV === 'development') {
      template = readFileSync(path.join(root, 'index.html'), 'utf8')
    }
    return template
  }

  app.use(
    '/assets/*',
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  app.use('*', serveStatic({ root, rewriteRequestPath: (p) => (p === '/' ? '/__none__' : p) }))

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404)
    let html: string
    try {
      html = loadTemplate()
    } catch {
      return c.text('frontend not built: run `pnpm build:web`, or start with --api-only', 500)
    }
    const meta = await pageMeta(ctx, c)
    // The shell is the same for every reader; its assets are hashed and cached for a year.
    // A shared cache keeps it for a minute, so a redeploy shows up within that minute.
    c.header('Cache-Control', 'public, max-age=0, s-maxage=60')
    return c.html(injectMeta(html, meta))
  })

  return app
}

interface PageMeta {
  title: string
  description: string
  image?: string | null
  type: 'website' | 'article'
}

async function pageMeta(ctx: AppContext, c: Context): Promise<PageMeta> {
  const site = readSiteSettings(ctx.db)
  const base: PageMeta = { title: site.title, description: site.description, type: 'website' }
  const page = /^\/p\/([^/]+)\/?$/.exec(c.req.path)
  if (page) {
    try {
      const ref = ctx.content.listPages().find((p) => p.slug === decodeURIComponent(page[1]!))
      return ref ? { ...base, title: `${ref.title} - ${site.title}` } : base
    } catch {
      return base
    }
  }
  const m = /^\/s\/([^/]+)(?:\/(\d+))?(?:\/source)?\/?$/.exec(c.req.path)
  if (!m) return base
  try {
    const series = decodeURIComponent(m[1]!)
    if (!m[2]) {
      const s = ctx.content.getSeries(series)
      return s ? { ...base, title: `${s.title} - ${site.title}`, description: s.description, image: s.cover } : base
    }
    const article = ctx.content.listArticles({ series }).find((a) => a.chapter === Number(m[2]))
    if (!article) return base
    return {
      title: `${article.title} - ${site.title}`,
      description: article.summary,
      image: article.cover,
      type: 'article',
    }
  } catch {
    return base
  }
}

function injectMeta(html: string, meta: PageMeta): string {
  const tags = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}">`,
    `<meta property="og:title" content="${escape(meta.title)}">`,
    `<meta property="og:description" content="${escape(meta.description)}">`,
    `<meta property="og:type" content="${meta.type}">`,
    meta.image ? `<meta property="og:image" content="${escape(meta.image)}">` : '',
  ].join('\n    ')
  return html.replace(/<title>.*?<\/title>/s, '').replace('</head>', `    ${tags}\n  </head>`)
}
