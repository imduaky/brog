import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { resetPassword } from './auth/password.ts'
import { bootstrap } from './bootstrap.ts'
import { resolveStartup } from './config.ts'
import { openDb } from './db.ts'
import { resetServerSettings } from './server-settings.ts'

const HELP = `brog - git-backed blog

Usage: brog [options] [command]

Commands:
  serve            start the server (default)
  reset-password   forget the custom admin password; a random one is printed on next start
  reset-settings   restore the default server settings (cookie, CORS, proxy, ...)

Options (environment variable in brackets):
  --host <addr>       listen address, default 0.0.0.0        [BROG_HOST]
  --port <n>          listen port, default 8080              [BROG_PORT]
  --data <dir>        data directory, default ./data         [BROG_DATA_DIR]
  --web-dist <dir>    built frontend, default ./dist/web     [BROG_WEB_DIST]
  --api-only          do not serve the frontend              [BROG_SERVE_WEB=false]
  --git <path>        git executable, default git            [BROG_GIT]

Environment only:
  BROG_GITHUB_TOKEN   token for comments (GitHub Discussions). Never stored or shown.
  BROG_GITHUB_API     GraphQL endpoint, default https://api.github.com/graphql
  BROG_TRUST_PROXY    1 when behind a reverse proxy that sets X-Forwarded-For (the image sets it)

All other settings are edited in the admin panel (Settings).
`

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string', short: 'p' },
      data: { type: 'string' },
      'web-dist': { type: 'string' },
      'api-only': { type: 'boolean' },
      git: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const startup = resolveStartup(values, process.env)
  const command = positionals[0] ?? 'serve'

  if (command === 'reset-password' || command === 'reset-settings') {
    mkdirSync(startup.dataDir, { recursive: true })
    const db = openDb(path.join(startup.dataDir, 'brog.db'))
    if (command === 'reset-password') {
      resetPassword(db)
      console.log('Admin password reset. A new random password will be printed on the next start.')
    } else {
      resetServerSettings(db)
      console.log('Server settings reset to defaults. They apply on the next start.')
    }
    db.close()
    return
  }
  if (command !== 'serve') {
    console.error(HELP)
    process.exit(1)
  }

  const server = await bootstrap(startup)
  if (server.generatedPassword) {
    const line = '='.repeat(60)
    console.log(`\n${line}\n  Admin password: ${server.generatedPassword}\n`)
    console.log('  This password changes on every start until you set your own')
    console.log('  in the admin panel (type "www" on any page, then Settings).')
    console.log(`${line}\n`)
  }
  const http = serve({ fetch: server.app.fetch, hostname: startup.host, port: startup.port }, (info) => {
    console.log(`brog listening on http://${info.address}:${info.port}`)
    if (!startup.serveWeb) console.log('frontend is not served (--api-only): API and git only')
  })
  const shutdown = () => {
    http.close()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Started by the dev runner (scripts/dev.mjs) over an IPC channel: when that runner is gone, stop too.
  if (process.send) process.once('disconnect', shutdown)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
