import { Hono } from 'hono'
import { type AppContext, type Env } from '../context.ts'

/** /sh/<id> sends readers to the article. The id stays in the link; the redirect follows the current published version. */
export function shareRoutes(ctx: AppContext) {
  const app = new Hono<Env>()
  app.get('/:id', (c) => {
    const hit = ctx.shares.resolve(c.req.param('id'))
    if (!hit) return c.text('分享链接不存在或文章未发布\n', 404)
    c.header('Cache-Control', 'no-cache')
    // A relative target keeps the reader on the host the link was opened from (the share domain, if one is set).
    return c.redirect(`/s/${encodeURIComponent(hit.series)}/${hit.chapter}`, 302)
  })
  return app
}
