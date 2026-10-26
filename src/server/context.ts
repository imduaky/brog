import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import { AttemptLimiter, GitTokens } from './auth/tokens.ts'
import { Sessions } from './auth/session.ts'
import type { StartupOptions } from './config.ts'
import type { CommentService } from './comments/service.ts'
import type { ShareService } from './share/links.ts'
import type { ContentService } from './content/service.ts'
import type { DB } from './db.ts'
import type { BlogRepo } from './git/repo.ts'
import { RepoError } from './git/repo.ts'
import type { ServerSettingsStore } from './server-settings.ts'

export interface AppContext {
  startup: StartupOptions
  /** Live server settings: call settings.get() where a value is used, never cache it. */
  settings: ServerSettingsStore
  db: DB
  repo: BlogRepo
  content: ContentService
  comments: CommentService
  shares: ShareService
  sessions: Sessions
  tokens: GitTokens
  loginLimiter: AttemptLimiter
  pushLimiter: AttemptLimiter
}

export function createAppContext(
  startup: StartupOptions,
  settings: ServerSettingsStore,
  db: DB,
  repo: BlogRepo,
  content: ContentService,
  comments: CommentService,
  shares: ShareService,
): AppContext {
  return {
    startup,
    settings,
    db,
    repo,
    content,
    comments,
    shares,
    sessions: new Sessions(db, () => settings.get().sessionDays),
    tokens: new GitTokens(db),
    loginLimiter: new AttemptLimiter(10, 15 * 60 * 1000),
    pushLimiter: new AttemptLimiter(20, 15 * 60 * 1000),
  }
}

export type Env = { Variables: { admin: boolean } }

export function clientIp(ctx: AppContext, c: Context): string {
  if (ctx.startup.trustProxy || ctx.settings.get().trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (fwd) return fwd
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new RepoError('invalid JSON body')
  }
  const r = schema.safeParse(body)
  if (!r.success) throw new RepoError(z.prettifyError(r.error))
  return r.data
}

/** Series slug and chapter number from the route, validated. */
export const ChapterParams = z.object({
  series: z.string().min(1),
  chapter: z.coerce.number().int().min(1),
})
