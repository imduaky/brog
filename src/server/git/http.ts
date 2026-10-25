import { spawn } from 'node:child_process'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { gitEnvDefaults } from './exec.ts'
import type { BlogRepo, SyncResult } from './repo.ts'

export interface GitHttpRequest {
  method: string
  /** Path after the repository name, e.g. "/info/refs" */
  subPath: string
  query: string
  headers: Headers
  body: ReadableStream<Uint8Array> | null
  remoteAddr: string
  /** Authenticated as the owner (valid token). */
  authUser: string | null
}

const SMART_PATHS = new Set(['/info/refs', '/git-upload-pack', '/git-receive-pack'])

export function isSmartPath(subPath: string) {
  return SMART_PATHS.has(subPath)
}

export function isPushRequest(subPath: string, query: string) {
  return subPath === '/git-receive-pack' || new URLSearchParams(query).get('service') === 'git-receive-pack'
}

/**
 * Bridges a smart-HTTP request to `git http-backend` (CGI). Authenticated
 * requests see blog.git; anonymous ones see public.git (published commit only).
 */
export async function serveGitHttp(
  binary: string,
  repo: BlogRepo,
  req: GitHttpRequest,
  onPushed: (r: SyncResult) => void,
): Promise<Response> {
  const repoDir = req.authUser ? repo.gitDir : repo.publicDir
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...gitEnvDefaults,
    GIT_PROJECT_ROOT: path.dirname(repoDir),
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: `/${path.basename(repoDir)}${req.subPath}`,
    REQUEST_METHOD: req.method,
    QUERY_STRING: req.query,
    CONTENT_TYPE: req.headers.get('content-type') ?? '',
    REMOTE_ADDR: req.remoteAddr,
  }
  const encoding = req.headers.get('content-encoding')
  if (encoding) env.HTTP_CONTENT_ENCODING = encoding
  const protocol = req.headers.get('git-protocol')
  if (protocol) env.GIT_PROTOCOL = protocol
  const length = req.headers.get('content-length')
  if (length) env.CONTENT_LENGTH = length
  if (req.authUser) env.REMOTE_USER = req.authUser

  if (req.method === 'POST' && req.subPath === '/git-receive-pack') {
    let ready!: (r: Response) => void
    const response = new Promise<Response>((resolve) => (ready = resolve))
    repo
      .withExternalPush(() => runBackend(binary, env, req.body, ready))
      .then(onPushed)
      .catch((err) => {
        console.error('[git] push failed', err)
        ready(new Response('push failed\n', { status: 500 }))
      })
    return response
  }
  let ready!: (r: Response) => void
  const response = new Promise<Response>((resolve) => (ready = resolve))
  runBackend(binary, env, req.body, ready).catch((err) => {
    console.error('[git] http-backend failed', err)
    ready(new Response('git error\n', { status: 500 }))
  })
  return response
}

/** Runs http-backend; resolves `ready` once CGI headers are parsed, returns when the process exits. */
function runBackend(
  binary: string,
  env: NodeJS.ProcessEnv,
  body: ReadableStream<Uint8Array> | null,
  ready: (r: Response) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['http-backend'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.stdin.on('error', () => {})
    if (body) Readable.fromWeb(body as NodeReadableStream<Uint8Array>).pipe(child.stdin)
    else child.stdin.end()

    let head = Buffer.alloc(0)
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let headersDone = false
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c
      },
      cancel: () => {
        child.kill()
      },
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (headersDone) {
        controller.enqueue(new Uint8Array(chunk))
        return
      }
      head = Buffer.concat([head, chunk])
      const crlf = head.indexOf('\r\n\r\n')
      const lf = head.indexOf('\n\n')
      const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf
      if (end < 0) return
      const sepLen = end === crlf ? 4 : 2
      const { status, headers } = parseCgiHeaders(head.subarray(0, end).toString('latin1'))
      headersDone = true
      const rest = head.subarray(end + sepLen)
      if (rest.length) controller.enqueue(new Uint8Array(rest))
      ready(new Response(stream, { status, headers }))
    })
    child.on('close', (code) => {
      if (!headersDone) ready(new Response(stderr || 'git error\n', { status: 500 }))
      try {
        controller.close()
      } catch {}
      if (code !== 0 && stderr) console.error(`[git] http-backend: ${stderr.trim()}`)
      resolve()
    })
  })
}

function parseCgiHeaders(text: string): { status: number; headers: Headers } {
  const headers = new Headers()
  let status = 200
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10) || 200
    else headers.append(name, value)
  }
  return { status, headers }
}
