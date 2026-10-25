import path from 'node:path'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { resetPassword } from './auth/password.ts'
import { bootstrap } from './bootstrap.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'

const HELP = `brog - git-backed blog

Usage: brog [--config brog.yaml] [command]

Commands:
  serve            start the server (default)
  reset-password   forget the custom admin password; a random one is printed on next start
`

async function main() {
  const { values, positionals } = parseArgs({
    options: { config: { type: 'string', short: 'c' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const config = loadConfig(values.config)
  const command = positionals[0] ?? 'serve'

  if (command === 'reset-password') {
    const db = openDb(path.join(config.resolved.dataDir, 'brog.db'))
    resetPassword(db)
    db.close()
    console.log('Admin password reset. A new random password will be printed on the next start.')
    return
  }
  if (command !== 'serve') {
    console.error(HELP)
    process.exit(1)
  }

  const server = await bootstrap(config)
  if (server.generatedPassword) {
    const line = '='.repeat(60)
    console.log(`\n${line}\n  Admin password: ${server.generatedPassword}\n`)
    console.log('  This password changes on every start until you set your own')
    console.log('  in the admin panel (type "www" on any page, then Settings).')
    console.log(`${line}\n`)
  }
  const { host, port } = config.server
  const http = serve({ fetch: server.app.fetch, hostname: host, port }, (info) => {
    console.log(`brog listening on http://${info.address}:${info.port}`)
    if (!config.server.serveWeb) console.log('serveWeb is off: API and git only')
  })
  const shutdown = () => {
    http.close()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
