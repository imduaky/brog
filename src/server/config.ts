import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

const ConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default('0.0.0.0'),
      port: z.number().int().min(1).max(65535).default(8080),
      /** Public origin, e.g. https://blog.example.com. Used for clone URLs and meta tags. */
      baseUrl: z.string().url().optional(),
      /** Serve the built frontend from webDist. Disable for a backend-only deployment. */
      serveWeb: z.boolean().default(true),
      webDist: z.string().default('./dist/web'),
      /** Read the client IP from X-Forwarded-For (only enable behind a reverse proxy). */
      trustProxy: z.boolean().default(false),
      /** Extra origins allowed to call the API with credentials (separately deployed frontend). */
      corsOrigins: z.array(z.string()).default([]),
    })
    .prefault({}),
  data: z
    .object({
      /** Holds brog.db, the git repositories and the server-side workspace. */
      dir: z.string().default('./data'),
    })
    .prefault({}),
  site: z
    .object({
      title: z.string().default('My Blog'),
      description: z.string().default(''),
      /** Owner name. Also the username for authenticated git push. */
      owner: z.string().regex(/^[A-Za-z0-9._-]+$/).default('owner'),
      language: z.string().default('zh-CN'),
    })
    .prefault({}),
  auth: z
    .object({
      sessionDays: z.number().int().min(1).default(7),
      /** "auto" marks the cookie Secure when baseUrl is https. */
      cookieSecure: z.union([z.boolean(), z.literal('auto')]).default('auto'),
      /** Use "none" only for a frontend on another site (requires Secure). */
      cookieSameSite: z.enum(['strict', 'lax', 'none']).default('lax'),
    })
    .prefault({}),
  git: z
    .object({
      binary: z.string().default('git'),
      authorName: z.string().optional(),
      authorEmail: z.string().default('brog@localhost'),
    })
    .prefault({}),
  search: z
    .object({
      /**
       * Index the body of every published chapter (SQLite FTS5, trigram).
       * Indexing is incremental and queries are indexed, so it is on by default.
       * Turn it off to search only titles, tags and summaries.
       */
      fullText: z.boolean().default(true),
    })
    .prefault({}),
})

export type Config = z.infer<typeof ConfigSchema> & {
  /** Absolute paths derived from the config file location. */
  resolved: { dataDir: string; webDist: string }
}

/** Uses --config, else ./brog.yaml when present, else built-in defaults. */
export function loadConfig(file: string | undefined): Config {
  const candidate = file ?? (existsSync('brog.yaml') ? 'brog.yaml' : undefined)
  let raw: unknown = {}
  let baseDir = process.cwd()
  if (candidate) {
    const abs = path.resolve(candidate)
    raw = parse(readFileSync(abs, 'utf8')) ?? {}
    baseDir = path.dirname(abs)
  }
  return resolveConfig(raw, baseDir)
}

export function resolveConfig(raw: unknown, baseDir: string): Config {
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid config:\n${z.prettifyError(parsed.error)}`)
  }
  const cfg = parsed.data
  return {
    ...cfg,
    resolved: {
      dataDir: path.resolve(baseDir, cfg.data.dir),
      webDist: path.resolve(baseDir, cfg.server.webDist),
    },
  }
}

export function cookieIsSecure(cfg: Config): boolean {
  if (cfg.auth.cookieSecure !== 'auto') return cfg.auth.cookieSecure
  return cfg.server.baseUrl?.startsWith('https://') ?? false
}
