import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { gitEnvDefaults } from './exec.ts'

export interface GitObject {
  oid: string
  type: string
  data: Buffer
}

interface Pending {
  resolve: (obj: GitObject | null) => void
  reject: (err: Error) => void
}

/**
 * A long-running `git cat-file --batch` process. Reading published content
 * happens on every page view, so we avoid spawning git per request.
 */
export class CatFile {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private queue: Pending[] = []

  constructor(
    private readonly binary: string,
    private readonly gitDir: string,
  ) {}

  /** `spec` is an oid or `<rev>:<path>`. Resolves null when the object does not exist. */
  read(spec: string): Promise<GitObject | null> {
    if (spec.includes('\n')) return Promise.resolve(null)
    const child = this.ensure()
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject })
      child.stdin.write(`${spec}\n`)
    })
  }

  async readText(spec: string): Promise<string | null> {
    const obj = await this.read(spec)
    return obj && obj.type === 'blob' ? obj.data.toString('utf8') : null
  }

  close() {
    this.child?.stdin.end()
    this.child = null
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(this.binary, [`--git-dir=${this.gitDir}`, 'cat-file', '--batch'], {
      env: { ...process.env, ...gitEnvDefaults },
    })
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    const fail = (err: Error) => {
      if (this.child === child) this.child = null
      this.buffer = Buffer.alloc(0)
      for (const p of this.queue.splice(0)) p.reject(err)
    }
    child.on('error', fail)
    child.on('close', () => fail(new Error('git cat-file exited')))
    child.stdin.on('error', () => {})
    this.child = child
    return child
  }

  private drain() {
    while (this.queue.length > 0) {
      const nl = this.buffer.indexOf(0x0a)
      if (nl < 0) return
      const header = this.buffer.subarray(0, nl).toString('utf8')
      if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
        this.buffer = this.buffer.subarray(nl + 1)
        this.queue.shift()!.resolve(null)
        continue
      }
      const [oid, type, sizeStr] = header.split(' ')
      const size = Number(sizeStr)
      // header \n <size bytes> \n
      if (this.buffer.length < nl + 1 + size + 1) return
      const data = Buffer.from(this.buffer.subarray(nl + 1, nl + 1 + size))
      this.buffer = this.buffer.subarray(nl + 1 + size + 1)
      this.queue.shift()!.resolve({ oid: oid!, type: type!, data })
    }
  }
}
