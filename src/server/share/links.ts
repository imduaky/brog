import { randomInt } from 'node:crypto'
import type { ServerSettings, ShareLink } from '../../shared/types.ts'
import type { ContentService } from '../content/service.ts'
import type { DB } from '../db.ts'
import { AttemptLimiter } from '../auth/tokens.ts'
import { RepoError } from '../git/repo.ts'

/** Four letters or digits: 62^4 = 14,776,336 links in all. Ids are case-sensitive. */
export const SHARE_ID = /^[A-Za-z0-9]{4}$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ATTEMPTS = 50

/** The link a reader gets: the share domain if set, else the main site (public address, or the request's origin). */
export function shareUrl(settings: ServerSettings, requestOrigin: string, id: string): string {
  const origin = settings.shareOrigin || settings.baseUrl || requestOrigin
  return `${origin}/sh/${id}`
}

/**
 * Share links to articles. A link only ever leads to a published article, so drafts stay
 * hidden and a link to an unpublished article answers 404 until it is published again.
 *
 * Two kinds exist. The admin makes any number of links. Each article also has one visitor
 * link, which every reader gets: it is created on the first request and reused after that.
 * The service runs synchronously against SQLite, so the get-or-create below cannot interleave.
 */
export class ShareService {
  /** Readers may remove a visitor link. Every attempt counts, per IP, so one reader cannot keep removing it. */
  readonly visitorRemoveLimiter = new AttemptLimiter(10, 10 * 60 * 1000)

  constructor(
    private readonly db: DB,
    private readonly content: ContentService,
  ) {}

  private isPublished(series: string, chapter: number): boolean {
    return this.content.listArticles().some((a) => a.series === series && a.chapter === chapter)
  }

  private requirePublished(series: string, chapter: number) {
    if (!this.isPublished(series, chapter)) throw new RepoError('文章尚未发布，发布后才能创建分享链接', 409)
  }

  /** Every link of an article: the visitor link first, then the admin's, oldest first. */
  list(series: string, chapter: number): { id: string; createdAt: number; visitor: boolean }[] {
    return (
      this.db
        .prepare('SELECT id, created_at, visitor FROM share_links WHERE series = ? AND chapter = ? ORDER BY visitor DESC, created_at, id')
        .all(series, chapter) as { id: string; created_at: number; visitor: number }[]
    ).map((r) => ({ id: r.id, createdAt: r.created_at, visitor: r.visitor === 1 }))
  }

  /** An admin link: any number per article. */
  create(series: string, chapter: number): { id: string; createdAt: number; visitor: boolean } {
    this.requirePublished(series, chapter)
    return this.insert(series, chapter, false)
  }

  /** The visitor link of an article. With `create` false, returns null when none exists yet. */
  visitorLink(series: string, chapter: number, create: boolean): { id: string; createdAt: number; visitor: boolean } | null {
    this.requirePublished(series, chapter)
    const row = this.db
      .prepare('SELECT id, created_at FROM share_links WHERE series = ? AND chapter = ? AND visitor = 1')
      .get(series, chapter) as { id: string; created_at: number } | undefined
    if (row) return { id: row.id, createdAt: row.created_at, visitor: true }
    return create ? this.insert(series, chapter, true) : null
  }

  private insert(series: string, chapter: number, visitor: boolean): { id: string; createdAt: number; visitor: boolean } {
    for (let i = 0; i < ATTEMPTS; i++) {
      const id = Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
      if (this.db.prepare('SELECT 1 FROM share_links WHERE id = ?').get(id)) continue
      const createdAt = Date.now()
      this.db
        .prepare('INSERT INTO share_links (id, series, chapter, created_at, visitor) VALUES (?, ?, ?, ?, ?)')
        .run(id, series, chapter, createdAt, visitor ? 1 : 0)
      return { id, createdAt, visitor }
    }
    throw new RepoError('暂时无法生成新的分享链接编号，请稍后再试', 500)
  }

  /** Removes the article's visitor link for everyone. Admin links are not touched. */
  revokeVisitor(series: string, chapter: number): boolean {
    return this.db.prepare('DELETE FROM share_links WHERE series = ? AND chapter = ? AND visitor = 1').run(series, chapter).changes > 0
  }

  revoke(id: string): boolean {
    if (!SHARE_ID.test(id)) return false
    return this.db.prepare('DELETE FROM share_links WHERE id = ?').run(id).changes > 0
  }

  /** The article a link points to, or null when the link is unknown or the article is not published. */
  resolve(id: string): { series: string; chapter: number } | null {
    if (!SHARE_ID.test(id)) return null
    const row = this.db.prepare('SELECT series, chapter FROM share_links WHERE id = ?').get(id) as
      | { series: string; chapter: number }
      | undefined
    if (!row || !this.isPublished(row.series, row.chapter)) return null
    return row
  }

  /** The links of one article, with their full addresses, for the admin. */
  view(settings: ServerSettings, requestOrigin: string, series: string, chapter: number): ShareLink[] {
    return this.list(series, chapter).map((l) => ({ ...l, url: shareUrl(settings, requestOrigin, l.id) }))
  }

  /** One link with its address, for a reader. */
  withUrl(settings: ServerSettings, requestOrigin: string, link: { id: string; createdAt: number; visitor: boolean }): ShareLink {
    return { ...link, url: shareUrl(settings, requestOrigin, link.id) }
  }
}
