import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import { AttemptLimiter, GitTokens } from './auth/tokens.ts'
import { Sessions } from './auth/session.ts'
import type { Config } from './config.ts'
import type { ContentService } from './content/service.ts'
import type { DB } from './db.ts'
import type { BlogRepo } from './git/repo.ts'
import { RepoError } from './git/repo.ts'

export interface AppContext {
  config: Config
  db: DB
  repo: BlogRepo
  content: ContentService
  sessions: Sessions
  tokens: GitTokens
  loginLimiter: AttemptLimiter
  pushLimiter: AttemptLimiter
}

export function createAppContext(config: Config, db: DB, repo: BlogRepo, content: ContentService): AppContext {
  return {
    config,
    db,
    repo,
    content,
    sessions: new Sessions(db, config.auth.sessionDays),
    tokens: new GitTokens(db),
    loginLimiter: new AttemptLimiter(10, 15 * 60 * 1000),
    pushLimiter: new AttemptLimiter(20, 15 * 60 * 1000),
  }
}

export type Env = { Variables: { admin: boolean } }

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
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
