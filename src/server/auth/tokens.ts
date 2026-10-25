import { createHash, randomBytes } from 'node:crypto'
import type { GitTokenInfo } from '../../shared/types.ts'
import type { DB } from '../db.ts'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Personal access tokens for `git push` (HTTP Basic auth: owner + token). */
export class GitTokens {
  constructor(private readonly db: DB) {}

  create(name: string): { token: string; info: GitTokenInfo } {
    const token = `brog_${randomBytes(30).toString('base64url')}`
    const now = Date.now()
    const r = this.db
      .prepare('INSERT INTO git_tokens (name, token_hash, created_at) VALUES (?, ?, ?)')
      .run(name, hash(token), now)
    return { token, info: { id: Number(r.lastInsertRowid), name, createdAt: now, lastUsedAt: null } }
  }

  list(): GitTokenInfo[] {
    return (
      this.db.prepare('SELECT id, name, created_at, last_used_at FROM git_tokens ORDER BY id DESC').all() as {
        id: number
        name: string
        created_at: number
        last_used_at: number | null
      }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }))
  }

  revoke(id: number): boolean {
    return this.db.prepare('DELETE FROM git_tokens WHERE id = ?').run(id).changes > 0
  }

  verify(token: string): boolean {
    if (!token.startsWith('brog_')) return false
    // Lookup by sha256 of the token: no timing side channel on the secret itself.
    const row = this.db.prepare('SELECT id FROM git_tokens WHERE token_hash = ?').get(hash(token)) as
      | { id: number }
      | undefined
    if (!row) return false
    this.db.prepare('UPDATE git_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)
    return true
  }
}

/** Fixed-window limiter for failed login / push attempts, keyed by client IP. */
export class AttemptLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  blocked(key: string): boolean {
    const h = this.hits.get(key)
    if (!h) return false
    if (h.resetAt <= Date.now()) {
      this.hits.delete(key)
      return false
    }
    return h.count >= this.max
  }

  fail(key: string) {
    const now = Date.now()
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
    else h.count++
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
    }
  }

  clear(key: string) {
    this.hits.delete(key)
  }
}
