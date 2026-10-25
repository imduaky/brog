import { type Context, Hono } from 'hono'
import { type AppContext, clientIp, type Env } from '../context.ts'
import { setSetting } from '../db.ts'
import { isPushRequest, isSmartPath, serveGitHttp } from '../git/http.ts'

const UNAUTHORIZED = () =>
  new Response('authentication required\n', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="brog", charset="UTF-8"' },
  })

/**
 * git smart HTTP.
 * - /git/blog.git       anyone can clone/fetch the published commit; push needs auth.
 * - /git/full/blog.git  always asks for credentials and serves the full main (drafts included).
 *   git only sends credentials after a 401 challenge, so writers use this URL.
 * Auth is HTTP Basic: username = site.owner, password = a token issued in the admin UI.
 */
export function gitRoutes(ctx: AppContext) {
  const app = new Hono<Env>()
  app.all('/blog.git/*', (c) => handle(c, false))
  app.all('/full/blog.git/*', (c) => handle(c, true))

  async function handle(c: Context<Env>, requireAuth: boolean) {
    const url = new URL(c.req.url)
    const subPath = url.pathname.replace(/^.*\/blog\.git/, '')
    if (!isSmartPath(subPath)) return c.text('only the smart HTTP protocol is supported\n', 404)
    const ip = clientIp(c, ctx.config.server.trustProxy)

    let authUser: string | null = null
    const auth = c.req.header('authorization')
    if (auth?.startsWith('Basic ')) {
      if (ctx.pushLimiter.blocked(ip)) return c.text('too many failed attempts\n', 429)
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
      const sep = decoded.indexOf(':')
      const user = decoded.slice(0, sep)
      const token = decoded.slice(sep + 1)
      if (sep < 0 || user !== ctx.config.site.owner || !ctx.tokens.verify(token)) {
        ctx.pushLimiter.fail(ip)
        return UNAUTHORIZED()
      }
      authUser = user
    }
    if (!authUser && (requireAuth || isPushRequest(subPath, url.search.slice(1)))) return UNAUTHORIZED()

    return serveGitHttp(
      ctx.config.git.binary,
      ctx.repo,
      {
        method: c.req.method,
        subPath,
        query: url.search.slice(1),
        headers: c.req.raw.headers,
        body: c.req.raw.body,
        remoteAddr: ip,
        authUser,
      },
      (r) => {
        if (r.conflicts.length) {
          setSetting(
            ctx.db,
            'workspace_warning',
            `外部 push 后重新应用未提交修改时出现冲突，请处理冲突标记：${r.conflicts.join(', ')}`,
          )
        } else if (r.stashKept) {
          setSetting(
            ctx.db,
            'workspace_warning',
            '外部 push 后无法重新应用未提交的修改，修改保存在 refs/stash 中（git stash list 查看）。',
          )
        }
      },
    )
  }

  return app
}
