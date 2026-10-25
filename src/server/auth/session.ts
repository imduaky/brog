import { createHash, randomBytes } from 'node:crypto'
import type { DB } from '../db.ts'

export const SESSION_COOKIE = 'brog_session'
const DAY = 24 * 60 * 60 * 1000
/** Renew at most once an hour so page views do not write to the database each time. */
const RENEW_INTERVAL = 60 * 60 * 1000

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export interface Session {
  expiresAt: number
  /** The expiry moved forward during this check; the cookie must be re-sent. */
  renewed: boolean
}

export class Sessions {
  constructor(
    private readonly db: DB,
    private readonly days: number,
  ) {}

  get maxAgeSeconds() {
    return this.days * 24 * 60 * 60
  }

  create(userAgent: string | undefined): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    const expiresAt = now + this.days * DAY
    this.db
      .prepare('INSERT INTO sessions (token_hash, created_at, expires_at, renewed_at, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(hash(token), now, expiresAt, now, userAgent?.slice(0, 200) ?? null)
    return { token, expiresAt }
  }

  /** Validates a session token and slides its expiry forward to `days` from now. */
  check(token: string | undefined): Session | null {
    if (!token) return null
    const key = hash(token)
    const row = this.db.prepare('SELECT expires_at, renewed_at FROM sessions WHERE token_hash = ?').get(key) as
      | { expires_at: number; renewed_at: number }
      | undefined
    const now = Date.now()
    if (!row) return null
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(key)
      return null
    }
    if (now - row.renewed_at < RENEW_INTERVAL) return { expiresAt: row.expires_at, renewed: false }
    const expiresAt = now + this.days * DAY
    this.db.prepare('UPDATE sessions SET expires_at = ?, renewed_at = ? WHERE token_hash = ?').run(expiresAt, now, key)
    return { expiresAt, renewed: true }
  }

  revoke(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token))
  }

  revokeAllExcept(token: string | undefined) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash != ?').run(token ? hash(token) : '')
  }

  purgeExpired() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  }
}
