import path from 'node:path'
import { GITHUB_GRAPHQL } from './comments/github.ts'

/**
 * What has to be known before the database opens. Everything else is a server
 * setting stored in SQLite and edited in the admin panel (see server-settings.ts).
 */
export interface StartupOptions {
  host: string
  port: number
  /** Absolute. Holds brog.db and the git repositories. */
  dataDir: string
  /** Serve the built frontend. Off for a backend-only deployment. */
  serveWeb: boolean
  /** Absolute */
  webDist: string
  gitBinary: string
  /** GitHub token for comments. From BROG_GITHUB_TOKEN only: never stored in the database or shown. */
  githubToken?: string
  /** GitHub GraphQL endpoint. Change it for GitHub Enterprise or a local test double. */
  githubApi: string
}

export interface StartupArgs {
  host?: string
  port?: string
  data?: string
  'web-dist'?: string
  'api-only'?: boolean
  git?: string
}

const bool = (v: string | undefined) => (v === undefined || v === '' ? undefined : !/^(0|false|no|off)$/i.test(v))

/** Command-line flags first, then BROG_* environment variables, then the defaults. */
export function resolveStartup(args: StartupArgs, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): StartupOptions {
  const port = Number(args.port ?? env.BROG_PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${args.port ?? env.BROG_PORT}`)
  return {
    host: args.host ?? env.BROG_HOST ?? '0.0.0.0',
    port,
    dataDir: path.resolve(cwd, args.data ?? env.BROG_DATA_DIR ?? './data'),
    serveWeb: args['api-only'] ? false : (bool(env.BROG_SERVE_WEB) ?? true),
    webDist: path.resolve(cwd, args['web-dist'] ?? env.BROG_WEB_DIST ?? './dist/web'),
    gitBinary: args.git ?? env.BROG_GIT ?? 'git',
    githubToken: env.BROG_GITHUB_TOKEN?.trim() || undefined,
    githubApi: env.BROG_GITHUB_API?.trim() || GITHUB_GRAPHQL,
  }
}
