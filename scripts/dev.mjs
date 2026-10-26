// Development runner: the web dev server (Vite, in this process) and the API server
// (a child process, restarted when its sources change).
//
// Everything hangs off this one process, so stopping it stops everything:
// - Ctrl+C, SIGTERM and SIGHUP stop the API child, then Vite, then exit.
// - If the runner is killed hard, the API child sees its IPC channel close and exits
//   (see `process.once('disconnect')` in src/server/main.ts).
// - If the parent (pnpm) goes away, the runner notices the PID change and stops itself.

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** Changes here restart the API. The web app reloads itself through Vite's HMR. */
const API_SOURCES = ['src/server', 'src/shared'].map((d) => path.join(root, d))
const RESTART_DELAY_MS = 150
const STOP_TIMEOUT_MS = 3000
const PARENT_CHECK_MS = 1000

const log = (msg) => console.log(`[dev] ${msg}`)
const startParent = process.ppid

let vite = null
let api = null // { proc, exited }
let stopping = null // promise, set once shutdown starts
let queue = Promise.resolve() // serialises restarts
let restartTimer = null
const watchers = []

function startApi() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  const exited = new Promise((resolve) => {
    proc.once('exit', (code, signal) => {
      resolve()
      if (api?.proc !== proc) return // stopped on purpose
      api = null
      if (!stopping) log(`api exited (${signal ?? `code ${code}`}); it restarts on the next change to src/server or src/shared`)
    })
  })
  api = { proc, exited }
}

async function stopApi() {
  if (!api) return
  const { proc, exited } = api
  api = null
  proc.kill('SIGTERM')
  const force = setTimeout(() => proc.kill('SIGKILL'), STOP_TIMEOUT_MS)
  await exited
  clearTimeout(force)
}

function restartApi() {
  queue = queue.then(async () => {
    await stopApi()
    if (!stopping) {
      log('restarting api')
      startApi()
    }
  })
}

function scheduleRestart(file) {
  if (file && !/\.(ts|json)$/.test(file)) return
  log(`${file ?? 'source'} changed`)
  clearTimeout(restartTimer)
  restartTimer = setTimeout(restartApi, RESTART_DELAY_MS)
}

/** Stops everything. Safe to call more than once. */
function shutdown(code = 0) {
  if (stopping) return stopping
  stopping = (async () => {
    clearTimeout(restartTimer)
    for (const w of watchers) w.close()
    clearInterval(parentTimer)
    await queue
    await stopApi()
    await vite?.close()
    process.exit(code)
  })()
  return stopping
}

const parentTimer = setInterval(() => {
  if (process.ppid !== startParent) {
    log('parent process is gone, stopping')
    shutdown(0)
  }
}, PARENT_CHECK_MS)

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(0))
process.on('uncaughtException', (err) => {
  console.error(err)
  shutdown(1)
})
// Last resort: nothing may outlive the runner, even if shutdown() never ran.
process.on('exit', () => api?.proc.kill('SIGKILL'))

try {
  vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    server: { strictPort: true },
  })
  await vite.listen()
  vite.printUrls()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  await shutdown(1)
}

startApi()
for (const dir of API_SOURCES) {
  watchers.push(watch(dir, { recursive: true }, (_event, file) => scheduleRestart(file)))
}
