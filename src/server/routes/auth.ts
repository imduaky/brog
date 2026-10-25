import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { SessionInfo } from '../../shared/types.ts'
import { changePassword, passwordChanged, verifyPassword } from '../auth/password.ts'
import { SESSION_COOKIE } from '../auth/session.ts'
import { cookieIsSecure } from '../config.ts'
import { type AppContext, clientIp, type Env, parseJson } from '../context.ts'

function writeSessionCookie(ctx: AppContext, c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieIsSecure(ctx.config) || ctx.config.auth.cookieSameSite === 'none',
    sameSite: ctx.config.auth.cookieSameSite === 'none' ? 'None' : ctx.config.auth.cookieSameSite === 'strict' ? 'Strict' : 'Lax',
    path: '/',
    maxAge: ctx.sessions.maxAgeSeconds,
  })
}

/** Checks the session cookie and slides its expiry (and the cookie's) forward. */
export function currentSession(ctx: AppContext, c: Context): SessionInfo {
  const token = getCookie(c, SESSION_COOKIE)
  const s = ctx.sessions.check(token)
  if (!s) return { admin: false, expiresAt: null }
  if (s.renewed) writeSessionCookie(ctx, c, token!)
  return { admin: true, expiresAt: s.expiresAt }
}

export const requireAdmin = (ctx: AppContext) =>
  createMiddleware<Env>(async (c, next) => {
    if (!currentSession(ctx, c).admin) return c.json({ error: 'unauthorized' }, 401)
    c.set('admin', true)
    await next()
  })

const PasswordHash = z.string().regex(/^[0-9a-f]{64}$/, 'expected sha256 hex')

export function authRoutes(ctx: AppContext) {
  const app = new Hono<Env>()

  app.get('/session', (c) => c.json(currentSession(ctx, c)))

  app.post('/login', async (c) => {
    const ip = clientIp(c, ctx.config.server.trustProxy)
    if (ctx.loginLimiter.blocked(ip)) return c.json({ error: '尝试次数过多，请 15 分钟后再试' }, 429)
    const { password } = await parseJson(c, z.object({ password: PasswordHash }))
    if (!(await verifyPassword(ctx.db, password))) {
      ctx.loginLimiter.fail(ip)
      return c.json({ error: '密码错误' }, 401)
    }
    ctx.loginLimiter.clear(ip)
    const { token, expiresAt } = ctx.sessions.create(c.req.header('user-agent'))
    writeSessionCookie(ctx, c, token)
    return c.json({ admin: true, expiresAt, passwordChanged: passwordChanged(ctx.db) })
  })

  app.post('/logout', (c) => {
    ctx.sessions.revoke(getCookie(c, SESSION_COOKIE))
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.post('/password', requireAdmin(ctx), async (c) => {
    const body = await parseJson(c, z.object({ current: PasswordHash, next: PasswordHash }))
    if (!(await verifyPassword(ctx.db, body.current))) return c.json({ error: '当前密码不正确' }, 400)
    await changePassword(ctx.db, body.next)
    // Other devices have to log in again with the new password.
    ctx.sessions.revokeAllExcept(getCookie(c, SESSION_COOKIE))
    return c.json({ ok: true })
  })

  app.get('/password-status', requireAdmin(ctx), (c) => c.json({ changed: passwordChanged(ctx.db) }))

  return app
}
