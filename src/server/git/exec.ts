import { spawn } from 'node:child_process'
import { devNull } from 'node:os'

export interface GitResult {
  code: number
  stdout: Buffer
  stderr: string
}

export interface GitRunOptions {
  input?: string | Buffer
  env?: NodeJS.ProcessEnv
  cwd?: string
  /** Do not throw on a non-zero exit code. */
  allowFail?: boolean
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} exited with ${code}: ${stderr.trim()}`)
  }
}

export function runGit(binary: string, args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...gitEnvDefaults, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = { code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }
      if (result.code !== 0 && !opts.allowFail) reject(new GitError(args, result.code, result.stderr))
      else resolve(result)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(opts.input)
  })
}

/** Keep git deterministic: no user/system config surprises, no pagers or prompts. */
export const gitEnvDefaults: NodeJS.ProcessEnv = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
}
