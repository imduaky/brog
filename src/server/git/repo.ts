import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeRepoPath } from '../../shared/paths.ts'
import type { CommitDetail, CommitInfo, ResetMode, StatusEntry } from '../../shared/types.ts'
import { Mutex } from '../util/mutex.ts'
import { CatFile } from './catfile.ts'
import { GitError, type GitRunOptions, runGit } from './exec.ts'

export interface RepoOptions {
  binary: string
  /** Directory that holds blog.git, public.git and workspace/. */
  root: string
  /** Read on every commit, so a changed setting applies without a restart. */
  author: () => { name: string; email: string }
}

export interface TreeEntry {
  path: string
  oid: string
  type: 'blob' | 'tree' | 'commit'
}

export interface SyncResult {
  /** HEAD moved because of the push. */
  updated: boolean
  /** Uncommitted web changes could not be re-applied cleanly; conflict markers were left in these files. */
  conflicts: string[]
  /** Re-applying failed completely; the changes are kept in refs/stash. */
  stashKept: boolean
}

export class RepoError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429 | 500 = 400,
  ) {
    super(message)
  }
}

const FIELD = '\x1f'
const RECORD = '\x1e'
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%b'].join('%x1f') + '%x1e'

/** The blog has a single branch: reject pushes to anything but main. */
const PRE_RECEIVE_HOOK = `#!/bin/sh
while read old new ref; do
  if [ "$ref" != "refs/heads/main" ]; then
    echo "brog: only refs/heads/main can be pushed (rejected $ref)" >&2
    exit 1
  fi
done
`

/**
 * The blog repository.
 *
 * - blog.git    bare repository, single branch `main`. Authenticated clone/push.
 * - public.git  shares blog.git's objects (alternates); its `main` is the published commit.
 *               Anonymous clones are served from here so drafts never leak.
 * - workspace/  the server-side work tree of blog.git (index lives in blog.git/index).
 *               The web editor writes here; stage/commit/reset behave exactly like git.
 */
export class BlogRepo {
  readonly gitDir: string
  readonly publicDir: string
  readonly workTree: string
  /** Serializes everything that touches the work tree, the index or refs. */
  readonly lock = new Mutex()
  readonly cat: CatFile

  constructor(private readonly opts: RepoOptions) {
    this.gitDir = path.join(opts.root, 'blog.git')
    this.publicDir = path.join(opts.root, 'public.git')
    this.workTree = path.join(opts.root, 'workspace')
    this.cat = new CatFile(opts.binary, this.gitDir)
  }

  // ---------------------------------------------------------------- setup

  /** Creates the repositories on first start. Returns true when a fresh repo was created. */
  async init(seed: Record<string, string>): Promise<boolean> {
    await mkdir(this.opts.root, { recursive: true })
    await mkdir(this.workTree, { recursive: true })
    let created = false
    if (!existsSync(path.join(this.gitDir, 'HEAD'))) {
      await runGit(this.opts.binary, ['init', '-q', '--bare', '-b', 'main', this.gitDir])
      created = true
    }
    const config: [string, string][] = [
      ['core.quotepath', 'false'],
      ['core.precomposeunicode', 'true'],
      ['receive.denyDeletes', 'true'],
      ['receive.denyDeleteCurrent', 'true'],
      ['http.receivepack', 'true'],
    ]
    for (const [k, v] of config) await this.git(['config', k, v])
    // Internal refs are never advertised to clients.
    await this.git(['config', '--unset-all', 'uploadpack.hideRefs'], { allowFail: true })
    await this.git(['config', '--add', 'uploadpack.hideRefs', 'refs/brog/'])
    await this.git(['config', '--add', 'uploadpack.hideRefs', 'refs/stash'])
    await this.git(['config', '--unset-all', 'receive.hideRefs'], { allowFail: true })
    await this.git(['config', '--add', 'receive.hideRefs', 'refs/brog/'])
    await this.git(['config', '--add', 'receive.hideRefs', 'refs/stash'])
    await writeFile(path.join(this.gitDir, 'hooks', 'pre-receive'), PRE_RECEIVE_HOOK, { mode: 0o755 })

    if (!existsSync(path.join(this.publicDir, 'HEAD'))) {
      await runGit(this.opts.binary, ['init', '-q', '--bare', '-b', 'main', this.publicDir])
    }
    await mkdir(path.join(this.publicDir, 'objects', 'info'), { recursive: true })
    await writeFile(
      path.join(this.publicDir, 'objects', 'info', 'alternates'),
      `${path.join(this.gitDir, 'objects')}\n`,
    )
    await runGit(this.opts.binary, [`--git-dir=${this.publicDir}`, 'config', 'http.receivepack', 'false'])

    if (created) {
      for (const [file, content] of Object.entries(seed)) await this.writeWorking(file, content)
      await this.git(['add', '-A'])
      await this.git(['commit', '-q', '-m', 'Initial commit'])
    }
    return created
  }

  // ---------------------------------------------------------------- low level

  git(args: string[], opts: GitRunOptions = {}) {
    const author = this.opts.author()
    return runGit(
      this.opts.binary,
      [`--git-dir=${this.gitDir}`, `--work-tree=${this.workTree}`, '-c', 'core.quotepath=false', ...args],
      {
        ...opts,
        cwd: this.workTree,
        env: {
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email,
          ...opts.env,
        },
      },
    )
  }

  async gitText(args: string[], opts: GitRunOptions = {}): Promise<string> {
    return (await this.git(args, opts)).stdout.toString('utf8')
  }

  // ---------------------------------------------------------------- refs

  async headOid(): Promise<string> {
    return (await this.gitText(['rev-parse', 'HEAD'])).trim()
  }

  /** Resolves a revision to a commit oid, or null. */
  async resolveCommit(rev: string): Promise<string | null> {
    if (!/^[0-9A-Za-z^~/._-]+$/.test(rev) || rev.startsWith('-')) return null
    const r = await this.git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true })
    return r.code === 0 ? r.stdout.toString().trim() : null
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await this.git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true })
    return r.code === 0
  }

  /** Point the published refs (private protection ref + public main) at a commit. */
  async setPublishedRefs(oid: string) {
    await this.git(['update-ref', 'refs/brog/published', oid])
    await runGit(this.opts.binary, [`--git-dir=${this.publicDir}`, 'update-ref', 'refs/heads/main', oid])
  }

  // ---------------------------------------------------------------- reading history

  async log(opts: { rev?: string; path?: string; limit?: number; skip?: number } = {}): Promise<CommitInfo[]> {
    const args = ['log', `--format=${LOG_FORMAT}`, '--parents', `-n${opts.limit ?? 100}`]
    if (opts.skip) args.push(`--skip=${opts.skip}`)
    args.push(opts.rev ?? 'HEAD', '--')
    if (opts.path) args.push(opts.path)
    const out = await this.gitText(args)
    return parseLog(out)
  }

  async show(oid: string): Promise<CommitDetail> {
    const commit = await this.resolveCommit(oid)
    if (!commit) throw new RepoError('commit not found', 404)
    const [info] = parseLog(await this.gitText(['log', '-n1', `--format=${LOG_FORMAT}`, commit]))
    const files = await this.gitText(['show', '--format=', '--name-status', '--no-renames', '-z', commit])
    const parts = files.split('\0').filter(Boolean)
    const changes: CommitDetail['files'] = []
    for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i]!, path: parts[i + 1]! })
    const patch = await this.gitText(['show', '--format=', '--patch', '--no-color', '--no-renames', commit])
    return { ...info!, files: changes, patch }
  }

  async listTree(rev: string, prefix?: string): Promise<TreeEntry[]> {
    const args = ['ls-tree', '-r', '-z', '--full-tree', rev]
    if (prefix) args.push('--', prefix)
    const out = await this.gitText(args)
    return out
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t')
        const [, type, oid] = line.slice(0, tab).split(' ')
        return { path: line.slice(tab + 1), oid: oid!, type: type as TreeEntry['type'] }
      })
  }

  async readAt(rev: string, file: string): Promise<Buffer | null> {
    const obj = await this.cat.read(`${rev}:${file}`)
    return obj && obj.type === 'blob' ? obj.data : null
  }

  // ---------------------------------------------------------------- work tree

  private abs(file: string): string {
    const norm = normalizeRepoPath(file)
    if (!norm) throw new RepoError(`invalid path: ${file}`)
    return path.join(this.workTree, norm)
  }

  async readWorking(file: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(file))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async writeWorking(file: string, data: string | Buffer) {
    const abs = this.abs(file)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, data)
  }

  async existsWorking(file: string): Promise<boolean> {
    try {
      await stat(this.abs(file))
      return true
    } catch {
      return false
    }
  }

  /** Deletes a file or a whole directory from the work tree. */
  async deleteWorking(file: string) {
    await rm(this.abs(file), { recursive: true, force: true })
    await this.pruneEmptyDirs(path.dirname(this.abs(file)))
  }

  private async pruneEmptyDirs(dir: string) {
    while (dir.startsWith(this.workTree) && dir !== this.workTree) {
      const entries = await readdir(dir).catch(() => null)
      if (!entries || entries.length > 0) return
      await rm(dir, { recursive: true, force: true })
      dir = path.dirname(dir)
    }
  }

  async listWorking(prefix = ''): Promise<string[]> {
    const base = prefix ? this.abs(prefix) : this.workTree
    const entries = await readdir(base, { recursive: true, withFileTypes: true }).catch(() => [])
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(this.workTree, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .filter((p) => normalizeRepoPath(p) === p)
      .sort()
  }

  async status(): Promise<StatusEntry[]> {
    const out = await this.gitText(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])
    return out
      .split('\0')
      .filter(Boolean)
      .map((line) => ({ index: line[0]!, worktree: line[1]!, path: line.slice(3) }))
  }

  async diff(opts: { path?: string; staged?: boolean } = {}): Promise<string> {
    const args = ['diff', '--no-color', '--no-renames']
    if (opts.staged) args.push('--cached')
    args.push('--')
    if (opts.path) args.push(opts.path)
    return this.gitText(args)
  }

  async stage(paths: string[]) {
    await this.git(['add', '-A', '--', ...this.checkedPaths(paths)])
  }

  async unstage(paths: string[]) {
    await this.git(['reset', '-q', 'HEAD', '--', ...this.checkedPaths(paths)])
  }

  /** Discard work-tree changes of the given paths (restore them from the index, drop untracked files). */
  async discard(paths: string[]) {
    const checked = this.checkedPaths(paths)
    await this.git(['checkout', '-q', '--', ...checked], { allowFail: true })
    await this.git(['clean', '-q', '-f', '--', ...checked])
  }

  async commit(message: string): Promise<string> {
    if (!message.trim()) throw new RepoError('commit message is required')
    const staged = (await this.status()).filter((s) => s.index !== ' ' && s.index !== '?')
    if (staged.length === 0) throw new RepoError('nothing staged to commit')
    await this.git(['commit', '-q', '--no-verify', '-F', '-'], { input: message })
    return this.headOid()
  }

  async reset(rev: string, mode: ResetMode) {
    const oid = await this.resolveCommit(rev)
    if (!oid) throw new RepoError('commit not found', 404)
    await this.git(['reset', '-q', `--${mode}`, oid])
  }

  async revert(rev: string): Promise<string> {
    const oid = await this.resolveCommit(rev)
    if (!oid) throw new RepoError('commit not found', 404)
    const parents = (await this.gitText(['rev-list', '--parents', '-n1', oid])).trim().split(' ').length - 1
    if (parents === 0) throw new RepoError('cannot revert the root commit')
    const args = ['revert', '--no-edit']
    if (parents > 1) args.push('-m', '1')
    const r = await this.git([...args, oid], { allowFail: true })
    if (r.code !== 0) {
      await this.git(['revert', '--abort'], { allowFail: true })
      throw new RepoError(`revert failed: ${r.stderr.trim() || r.stdout.toString().trim()}`, 409)
    }
    return this.headOid()
  }

  private checkedPaths(paths: string[]): string[] {
    if (paths.length === 0) throw new RepoError('no paths given')
    return paths.map((p) => {
      const n = normalizeRepoPath(p)
      if (!n) throw new RepoError(`invalid path: ${p}`)
      return n
    })
  }

  /** Commits whose subject or body contains `needle` (case-insensitive), with the files each one touched. */
  async searchCommits(rev: string, needle: string, limit = 30): Promise<(CommitInfo & { paths: string[] })[]> {
    const fields = ['%H', '%P', '%an', '%ae', '%at', '%s', '%b'].join('%x1f')
    const out = await this.gitText([
      'log',
      '-i',
      '--fixed-strings',
      `--grep=${needle}`,
      `-n${limit}`,
      `--format=%x1e${fields}%x1d`,
      '--name-only',
      rev,
      '--',
    ])
    return out
      .split(RECORD)
      .filter((chunk) => chunk.includes('\x1d'))
      .map((chunk) => {
        const [head, names = ''] = chunk.split('\x1d')
        return { ...parseRecord(head!), paths: names.split('\n').map((n) => n.trim()).filter(Boolean) }
      })
  }

  /**
   * Diff between two commits, optionally limited to one path. Patches past
   * `maxPatchBytes` are dropped and the response is marked truncated.
   */
  async compare(baseOid: string, headOid: string, opts: { path?: string; maxPatchBytes: number }) {
    const tail = opts.path ? ['--', opts.path] : []
    const common = ['diff', '--no-color', '--no-renames']
    const [numstat, nameStatus, patchOut] = await Promise.all([
      this.gitText([...common, '--numstat', '-z', baseOid, headOid, ...tail]),
      this.gitText([...common, '--name-status', '-z', baseOid, headOid, ...tail]),
      this.gitText([...common, '-p', baseOid, headOid, ...tail]),
    ])

    const stats = numstat.split('\0').filter(Boolean).map((line) => {
      const [added, deleted, ...rest] = line.split('\t')
      return { path: rest.join('\t'), binary: added === '-', additions: Number(added) || 0, deletions: Number(deleted) || 0 }
    })
    const names = nameStatus.split('\0').filter(Boolean)
    const statuses: { status: string; path: string }[] = []
    for (let i = 0; i + 1 < names.length; i += 2) statuses.push({ status: names[i]![0]!, path: names[i + 1]! })

    // `git diff -p` lists files in the same order as --name-status.
    const chunks = patchOut.split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '))
    if (chunks.length !== statuses.length || stats.length !== statuses.length) {
      throw new RepoError('diff output did not match file list', 500)
    }
    let budget = opts.maxPatchBytes
    let truncated = false
    const files = statuses.map((f, i) => {
      const st = stats[i]!
      const patch = chunks[i]!
      const size = Buffer.byteLength(patch)
      const keep = !st.binary && size <= budget
      if (keep) budget -= size
      else if (!st.binary) truncated = true
      return {
        path: f.path,
        status: f.status,
        additions: st.additions,
        deletions: st.deletions,
        binary: st.binary,
        patch: keep ? patch : '',
      }
    })
    return {
      files,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      truncated,
    }
  }

  // ---------------------------------------------------------------- external push

  /**
   * Run an external `git push` (receive-pack) while keeping the work tree consistent.
   * Uncommitted web changes are stashed, the push moves `main`, the work tree is
   * moved to the new HEAD and the changes are re-applied on top ("rebased").
   */
  async withExternalPush(run: () => Promise<void>): Promise<SyncResult> {
    return this.lock.run(async () => {
      const before = await this.headOid()
      const dirty = (await this.status()).length > 0
      if (dirty) await this.git(['stash', 'push', '-q', '--include-untracked', '-m', 'brog: external push'])
      try {
        await run()
      } finally {
        const after = await this.headOid()
        if (after !== before) await this.git(['reset', '-q', '--hard', after])
      }
      const updated = (await this.headOid()) !== before
      if (!dirty) return { updated, conflicts: [], stashKept: false }
      return { updated, ...(await this.restoreStash()) }
    })
  }

  private async restoreStash(): Promise<Omit<SyncResult, 'updated'>> {
    if ((await this.git(['stash', 'pop', '-q', '--index'], { allowFail: true })).code === 0) {
      return { conflicts: [], stashKept: false }
    }
    // Staged state could not be restored; fall back to restoring only the content.
    await this.git(['reset', '-q', '--hard'])
    await this.git(['clean', '-q', '-fd'])
    const r = await this.git(['stash', 'pop', '-q'], { allowFail: true })
    if (r.code === 0) return { conflicts: [], stashKept: false }
    const unmerged = (await this.status()).filter((s) => s.index === 'U' || s.worktree === 'U' || (s.index === 'A' && s.worktree === 'A'))
    if (unmerged.length === 0) {
      // Nothing applied (e.g. an untracked file collides with a pushed file). Keep the stash.
      return { conflicts: [], stashKept: true }
    }
    // Leave conflict markers in the files, clear the unmerged index state, drop the applied stash.
    await this.git(['reset', '-q'])
    await this.git(['stash', 'drop', '-q'], { allowFail: true })
    return { conflicts: unmerged.map((s) => s.path), stashKept: false }
  }
}

function parseLog(out: string): CommitInfo[] {
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.length > 0)
    .map(parseRecord)
}

function parseRecord(r: string): CommitInfo {
  const [oid, parents, author, email, time, subject, body] = r.split(FIELD)
  return {
    oid: oid!,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author: author!,
    email: email!,
    time: Number(time) * 1000,
    subject: subject!,
    body: (body ?? '').trim(),
  }
}

export { GitError }
