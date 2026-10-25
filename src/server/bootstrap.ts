import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createApp } from './app.ts'
import { ensurePassword } from './auth/password.ts'
import type { Config } from './config.ts'
import { SEED_FILES } from './content/seed.ts'
import { ContentService } from './content/service.ts'
import { type AppContext, createAppContext } from './context.ts'
import { openDb } from './db.ts'
import { BlogRepo } from './git/repo.ts'

export interface Server {
  ctx: AppContext
  app: ReturnType<typeof createApp>
  /** Set when a new random admin password was generated on this start. */
  generatedPassword: string | null
  close(): void
}

export async function bootstrap(config: Config): Promise<Server> {
  const dataDir = config.resolved.dataDir
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(path.join(dataDir, 'brog.db'))
  const repo = new BlogRepo({
    binary: config.git.binary,
    root: path.join(dataDir, 'git'),
    authorName: config.git.authorName ?? config.site.owner,
    authorEmail: config.git.authorEmail,
  })
  const created = await repo.init(SEED_FILES)
  const content = new ContentService(repo, db, config.search.fullText)
  if (created) await content.applyPublished(await repo.headOid())
  else await content.syncPublished()

  const ctx = createAppContext(config, db, repo, content)
  ctx.sessions.purgeExpired()
  const generatedPassword = ensurePassword(db)
  return {
    ctx,
    app: createApp(ctx),
    generatedPassword,
    close() {
      repo.cat.close()
      db.close()
    },
  }
}
