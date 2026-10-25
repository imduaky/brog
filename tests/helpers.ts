import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { CSRF_HEADER } from '../src/server/app.ts'
import { sha256Hex } from '../src/server/auth/password.ts'
import { bootstrap, type Server } from '../src/server/bootstrap.ts'
import { resolveConfig } from '../src/server/config.ts'

export interface TestServer {
  server: Server
  url: string
  dir: string
  password: string
  /** fetch with the admin cookie (after login()) and the CSRF header */
  api: (p: string, init?: RequestInit & { json?: unknown }) => Promise<Response>
  login: () => Promise<void>
  close: () => Promise<void>
}

export async function startServer(extra: Record<string, unknown> = {}): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'brog-test-'))
  const config = resolveConfig({ server: { serveWeb: false }, site: { owner: 'young' }, ...extra }, dir)
  const server = await bootstrap(config)
  const password = server.generatedPassword!
  const http = serve({ fetch: server.app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>((r) => http.once('listening', () => r()))
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  let cookie = ''

  const api: TestServer['api'] = async (p, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set(CSRF_HEADER, '1')
    if (cookie) headers.set('cookie', cookie)
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    return fetch(url + p, { ...init, headers, body })
  }

  return {
    server,
    url,
    dir,
    password,
    api,
    async login() {
      const r = await api('/api/auth/login', { method: 'POST', json: { password: sha256Hex(password) } })
      if (r.status !== 200) throw new Error(`login failed: ${r.status}`)
      cookie = r.headers.get('set-cookie')!.split(';')[0]!
    },
    async close() {
      const closed = new Promise<void>((r) => http.close(() => r()))
      if ('closeAllConnections' in http) http.closeAllConnections()
      await closed
      server.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Async on purpose: the server under test runs in this same process. */
export function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    }
    execFile('git', args, { cwd, env, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout),
    )
  })
}
