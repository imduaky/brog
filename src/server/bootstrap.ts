import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createApp } from './app.ts'
import { ensurePassword } from './auth/password.ts'
import type { StartupOptions } from './config.ts'
import { CommentService } from './comments/service.ts'
import { ShareService } from './share/links.ts'
import { SEED_FILES } from './content/seed.ts'
import { ContentService } from './content/service.ts'
import { type AppContext, createAppContext } from './context.ts'
import { openDb } from './db.ts'
import { BlogRepo } from './git/repo.ts'
import { authorOf, ServerSettingsStore } from './server-settings.ts'

export interface Server {
  ctx: AppContext
  app: ReturnType<typeof createApp>
  /** Set when a new random admin password was generated on this start. */
  generatedPassword: string | null
  close(): void
}

export interface BootstrapDeps {
  /** HTTP client for GitHub. Tests replace it with a fake GitHub. */
  fetch?: typeof fetch
}

export async function bootstrap(startup: StartupOptions, deps: BootstrapDeps = {}): Promise<Server> {
  const dataDir = startup.dataDir
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(path.join(dataDir, 'brog.db'))
  const settings = new ServerSettingsStore(db)
  const repo = new BlogRepo({
    binary: startup.gitBinary,
    root: path.join(dataDir, 'git'),
    author: () => authorOf(settings.get()),
  })
  const created = await repo.init(SEED_FILES)
  const content = new ContentService(repo, db, () => settings.get().fullText)
  if (created) await content.applyPublished(await repo.headOid())
  else await content.syncPublished()
  settings.onChange((next, prev) => {
    if (next.fullText !== prev.fullText) void content.reindex().catch((err) => console.error(err))
  })

  const comments = new CommentService(db, content, {
    token: startup.githubToken,
    endpoint: startup.githubApi,
    fetch: deps.fetch ?? fetch,
  })
  const shares = new ShareService(db, content)
  const ctx = createAppContext(startup, settings, db, repo, content, comments, shares)
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
