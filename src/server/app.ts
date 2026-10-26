import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { ZodError, z } from 'zod'
import type { AppContext, Env } from './context.ts'
import { RepoError } from './git/repo.ts'
import { GitHubError } from './comments/github.ts'
import { GitError } from './git/exec.ts'
import { adminRoutes } from './routes/admin.ts'
import { authRoutes } from './routes/auth.ts'
import { gitRoutes } from './routes/git.ts'
import { publicRoutes } from './routes/public.ts'
import { shareRoutes } from './routes/share.ts'
import { readSiteIcon } from './content/site-icon.ts'
import { webRoutes } from './routes/web.ts'

/**
 * Header every state-changing API request must carry. Browsers cannot add it
 * cross-origin without a CORS preflight, which only configured origins pass.
 */
export const CSRF_HEADER = 'x-brog-request'

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>()

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: undefined,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      xFrameOptions: 'SAMEORIGIN',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  )

  // The allowed origins are read per request, so a saved setting applies immediately.
  const corsMiddleware = cors({
    origin: (origin) => (ctx.settings.get().corsOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['Content-Type', CSRF_HEADER],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
  app.use('/api/*', (c, next) => (ctx.settings.get().corsOrigins.length ? corsMiddleware(c, next) : next()))

  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ error: `missing ${CSRF_HEADER} header` }, 403)
    }
    await next()
  })

  app.route('/api/auth', authRoutes(ctx))
  app.route('/api/admin', adminRoutes(ctx))
  app.route('/api', publicRoutes(ctx))
  app.route('/git', gitRoutes(ctx))
  app.route('/sh', shareRoutes(ctx))

  // The site icon: uploaded in the admin panel. Browsers ask for this path directly, so it is not left to the SPA.
  app.get('/favicon.ico', (c) => {
    const icon = readSiteIcon(ctx.db)
    if (!icon) return c.text('not found', 404)
    // A versioned URL (?v=<updatedAt>) is immutable; the bare path is short-lived, so a new icon shows up soon after an upload.
    const versioned = c.req.query('v') === String(icon.updatedAt)
    c.header('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    c.header('Content-Type', icon.mime)
    if (icon.mime === 'image/svg+xml') c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    return c.body(new Uint8Array(icon.data))
  })

  app.get('/images/:hash', async (c) => {
    const img = await ctx.content.readImage(c.req.param('hash'))
    if (!img) return c.text('not found', 404)
    c.header('Content-Type', img.mime)
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    // SVGs could carry scripts: never let an image response act as a document.
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    return c.body(new Uint8Array(img.data))
  })

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))
  if (ctx.startup.serveWeb) app.route('/', webRoutes(ctx))

  app.onError((err, c) => {
    if (err instanceof RepoError) return c.json({ error: err.message }, err.status)
    if (err instanceof GitHubError) return c.json({ error: err.message }, err.status)
    if (err instanceof ZodError) return c.json({ error: z.prettifyError(err) }, 400)
    if (err instanceof GitError) {
      console.error(err.message)
      return c.json({ error: err.stderr.trim() || 'git command failed' }, 409)
    }
    console.error(err)
    return c.json({ error: 'internal server error' }, 500)
  })

  return app
}
