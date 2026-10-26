import { z } from 'zod'
import type { CommentCategories, CommentItem, CommentSettings, CommentsResponse, CommentTestStep } from '../../shared/types.ts'
import { AttemptLimiter } from '../auth/tokens.ts'
import type { ContentService } from '../content/service.ts'
import type { DB } from '../db.ts'
import { RepoError } from '../git/repo.ts'
import { Mutex } from '../util/mutex.ts'
import { type FetchFn, GitHub, type RawComment, type RepositoryInfo } from './github.ts'
import {
  type CommentSettingsInput,
  REPO_RE,
  readStoredCommentSettings,
  type StoredCommentSettings,
  writeStoredCommentSettings,
} from './settings.ts'

/** Readers' comments are created on demand; the discussion is reused for every later comment. */
const CACHE_MS = 60_000
const POST_WINDOW_MS = 10 * 60 * 1000
const POSTS_PER_WINDOW = 5
/**
 * A comment posted through the site starts with its author's name in bold, then a blank line.
 * Comments written on GitHub have no such line and show their GitHub login instead.
 */
const GUEST_NAME = /^\*\*([^*\n]{1,30})\*\*\n\n/

export const CommentInput = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} _.-]{1,30}$/u, '昵称 1–30 个字符，可用字母、数字、中文、空格和 . _ -'),
  text: z.string().trim().min(1, '评论不能为空').max(2000, '评论最多 2000 字'),
})
export type CommentInput = z.infer<typeof CommentInput>

interface Thread {
  discussionId: string
  number: number
  url: string
}

export interface CommentServiceOptions {
  token?: string
  endpoint: string
  fetch: FetchFn
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Comments on articles, kept in GitHub Discussions. Each article path has one discussion. */
export class CommentService {
  /** Attempts to post, per IP. Every attempt counts, not only the accepted ones. */
  readonly postLimiter = new AttemptLimiter(POSTS_PER_WINDOW, POST_WINDOW_MS)
  private readonly github: GitHub | null
  private readonly cache = new Map<string, { at: number; total: number; comments: CommentItem[] }>()
  private readonly threadLock = new Mutex()

  constructor(
    private readonly db: DB,
    private readonly content: ContentService,
    opts: CommentServiceOptions,
  ) {
    this.github = opts.token ? new GitHub({ token: opts.token, endpoint: opts.endpoint, fetch: opts.fetch }) : null
  }

  stored(): StoredCommentSettings {
    return readStoredCommentSettings(this.db)
  }

  /** Readers see comments only when the switch is on and everything it needs is in place. */
  active(): boolean {
    const s = this.stored()
    return s.enabled && !!this.github && !!s.repoId && !!s.categoryId
  }

  settings(): CommentSettings {
    const s = this.stored()
    return {
      enabled: s.enabled,
      active: this.active(),
      repo: s.repo,
      categoryId: s.categoryId,
      categoryName: s.categoryName,
      tokenConfigured: !!this.github,
    }
  }

  private requireGitHub(): GitHub {
    if (!this.github) throw new RepoError('未设置环境变量 BROG_GITHUB_TOKEN（设置后需要重启服务）', 400)
    return this.github
  }

  private async lookupRepo(repo: string): Promise<RepositoryInfo> {
    const [owner, name] = repo.split('/') as [string, string]
    const info = await this.requireGitHub().repository(owner, name)
    if (!info) throw new RepoError(`找不到仓库 ${repo}，或令牌无权访问`, 404)
    if (!info.discussionsEnabled) {
      throw new RepoError(`仓库 ${repo} 没有开启 Discussions（仓库设置 → General → Features）`, 400)
    }
    return info
  }

  /** Discussion categories of a repository, for the admin to choose from. */
  async categories(repo: string): Promise<CommentCategories> {
    if (!REPO_RE.test(repo)) throw new RepoError('repo must be owner/name', 400)
    const info = await this.lookupRepo(repo)
    return { repoId: info.id, categories: info.categories }
  }

  /** Saves the settings. Enabling requires the token, a repository and a category; each is checked on GitHub. */
  async saveSettings(input: CommentSettingsInput): Promise<CommentSettings> {
    const prev = this.stored()
    const next: StoredCommentSettings = {
      enabled: input.enabled,
      repo: input.repo,
      repoId: '',
      categoryId: input.categoryId,
      categoryName: '',
    }
    if (next.repo && this.github) {
      const info = await this.lookupRepo(next.repo)
      next.repoId = info.id
      if (next.categoryId) {
        const cat = info.categories.find((c) => c.id === next.categoryId)
        if (!cat) throw new RepoError('所选分类不在这个仓库中，请重新读取分类', 400)
        next.categoryName = cat.name
      }
    }
    if (next.enabled && !this.github) throw new RepoError('开启评论前需要设置环境变量 BROG_GITHUB_TOKEN 并重启服务', 400)
    if (next.enabled && !(next.repoId && next.categoryId)) throw new RepoError('开启评论前请选择仓库与分类', 400)

    this.db.transaction(() => {
      // Discussion ids belong to one repository: a different repository starts with no threads.
      if (prev.repo !== next.repo || prev.repoId !== next.repoId) this.db.prepare('DELETE FROM comment_threads').run()
      writeStoredCommentSettings(this.db, next)
    })()
    this.cache.clear()
    return this.settings()
  }

  /**
   * Checks the configuration and the connection to GitHub, one step at a time. It reads only:
   * nothing is created or changed on GitHub. The write path is exercised by the first real comment.
   */
  async test(): Promise<CommentTestStep[]> {
    const s = this.stored()
    const steps: CommentTestStep[] = []
    const pending = (key: CommentTestStep['key'], label: string) =>
      steps.push({ key, label, ok: null, detail: '前面的检查未通过，未执行' })

    const github = this.github
    if (!github) {
      steps.push({ key: 'token', label: '令牌', ok: false, detail: '未设置环境变量 BROG_GITHUB_TOKEN。设置后需要重启服务。' })
      for (const [k, l] of [
        ['viewer', '连接 GitHub'],
        ['repo', '仓库'],
        ['category', '分类'],
        ['threads', '读取评论'],
        ['write', '写入'],
      ] as const) pending(k, l)
      return steps
    }
    steps.push({ key: 'token', label: '令牌', ok: true, detail: '已设置 BROG_GITHUB_TOKEN' })

    try {
      const login = await github.viewerLogin()
      steps.push({ key: 'viewer', label: '连接 GitHub', ok: true, detail: `已以 ${login} 的身份连接` })
    } catch (err) {
      steps.push({ key: 'viewer', label: '连接 GitHub', ok: false, detail: msg(err) })
      for (const [k, l] of [
        ['repo', '仓库'],
        ['category', '分类'],
        ['threads', '读取评论'],
        ['write', '写入'],
      ] as const) pending(k, l)
      return steps
    }

    let info: RepositoryInfo | null = null
    if (!s.repo) {
      steps.push({ key: 'repo', label: '仓库', ok: false, detail: '尚未保存仓库（owner/name）' })
    } else {
      try {
        const [owner, name] = s.repo.split('/') as [string, string]
        info = await github.repository(owner, name)
        if (!info) {
          steps.push({ key: 'repo', label: '仓库', ok: false, detail: `找不到 ${s.repo}，或令牌无权访问` })
        } else if (!info.discussionsEnabled) {
          steps.push({ key: 'repo', label: '仓库', ok: false, detail: `${s.repo} 没有开启 Discussions` })
          info = null
        } else {
          steps.push({
            key: 'repo',
            label: '仓库',
            ok: true,
            detail: `${s.repo} 可访问，Discussions 已开启${info.isPrivate ? '（私有仓库）' : ''}`,
          })
        }
      } catch (err) {
        steps.push({ key: 'repo', label: '仓库', ok: false, detail: msg(err) })
      }
    }

    if (!info) {
      pending('category', '分类')
    } else if (!s.categoryId) {
      steps.push({ key: 'category', label: '分类', ok: false, detail: '尚未保存分类' })
    } else {
      const cat = info.categories.find((c) => c.id === s.categoryId)
      steps.push(
        cat
          ? { key: 'category', label: '分类', ok: true, detail: `分类「${cat.name}」存在` }
          : { key: 'category', label: '分类', ok: false, detail: '分类不存在，请重新读取分类并保存' },
      )
    }

    const thread = this.anyThread()
    if (!thread) {
      steps.push({
        key: 'threads',
        label: '读取评论',
        ok: null,
        detail: '还没有评论讨论。发表第一条评论时会自动创建，之后这一项会读取它的评论数。',
      })
    } else {
      try {
        const n = await github.discussionCommentCount(thread.discussionId)
        steps.push({ key: 'threads', label: '读取评论', ok: true, detail: `讨论 #${thread.number} 可读取，共 ${n} 条评论` })
      } catch (err) {
        steps.push({ key: 'threads', label: '读取评论', ok: false, detail: msg(err) })
      }
    }

    steps.push({
      key: 'write',
      label: '写入',
      ok: null,
      detail: '测试不会在 GitHub 上创建或修改内容。发表第一条评论时会验证写入权限。',
    })
    return steps
  }

  /** Comments of an article. Empty while the feature is off. */
  async list(series: string, chapter: number): Promise<CommentsResponse> {
    if (!this.active()) return { enabled: false, total: 0, comments: [] }
    const thread = this.thread(series, chapter)
    if (!thread) return { enabled: true, total: 0, comments: [] }
    const hit = this.cache.get(thread.discussionId)
    if (hit && Date.now() - hit.at < CACHE_MS) return { enabled: true, total: hit.total, comments: hit.comments }
    const r = await this.requireGitHub().discussionComments(thread.discussionId)
    const comments = r.comments.map(toItem)
    this.cache.set(thread.discussionId, { at: Date.now(), total: r.total, comments })
    return { enabled: true, total: r.total, comments }
  }

  /** Posts a comment for a reader. The first comment of an article creates its discussion. */
  async post(series: string, chapter: number, input: CommentInput): Promise<CommentItem> {
    if (!this.active()) throw new RepoError('评论未开启', 403)
    const thread = await this.ensureThread(series, chapter)
    const raw = await this.requireGitHub().addComment(thread.discussionId, `**${input.name}**\n\n${input.text}`)
    this.cache.clear()
    return toItem(raw)
  }

  /** Deletes a comment by its GitHub id. Admin only (enforced by the route). */
  async remove(commentId: string): Promise<void> {
    await this.requireGitHub().deleteComment(commentId)
    this.cache.clear()
  }

  /** Comments belong to published articles only. */
  assertPublished(series: string, chapter: number) {
    if (!this.content.listArticles().some((a) => a.series === series && a.chapter === chapter)) {
      throw new RepoError('article not found', 404)
    }
  }

  private thread(series: string, chapter: number): Thread | null {
    const row = this.db
      .prepare('SELECT discussion_id, number, url FROM comment_threads WHERE series = ? AND chapter = ?')
      .get(series, chapter) as { discussion_id: string; number: number; url: string } | undefined
    return row ? { discussionId: row.discussion_id, number: row.number, url: row.url } : null
  }

  private anyThread(): Thread | null {
    const row = this.db.prepare('SELECT discussion_id, number, url FROM comment_threads LIMIT 1').get() as
      | { discussion_id: string; number: number; url: string }
      | undefined
    return row ? { discussionId: row.discussion_id, number: row.number, url: row.url } : null
  }

  private async ensureThread(series: string, chapter: number): Promise<Thread> {
    const existing = this.thread(series, chapter)
    if (existing) return existing
    return this.threadLock.run(async () => {
      const again = this.thread(series, chapter)
      if (again) return again
      const s = this.stored()
      const d = await this.requireGitHub().createDiscussion(
        s.repoId,
        s.categoryId,
        `[brog] ${series}/${chapter}`,
        `这是 brog 为文章 ${series}/${chapter} 自动创建的评论区，请勿删除此讨论。`,
      )
      this.db
        .prepare('INSERT INTO comment_threads (series, chapter, discussion_id, number, url, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(series, chapter, d.id, d.number, d.url, Date.now())
      return { discussionId: d.id, number: d.number, url: d.url }
    })
  }
}

/** Only https links from GitHub reach the page; anything else is dropped rather than rendered. */
const httpsOnly = (u: string | undefined | null) => (u && /^https:\/\//.test(u) ? u : null)

function toItem(c: RawComment): CommentItem {
  const body = c.body.replace(/\r\n/g, '\n')
  const guest = GUEST_NAME.exec(body)
  return {
    id: c.id,
    name: guest ? guest[1]! : (c.author?.login ?? 'ghost'),
    guest: !!guest,
    avatarUrl: guest ? null : httpsOnly(c.author?.avatarUrl),
    body: guest ? body.slice(guest[0].length) : body,
    createdAt: Date.parse(c.createdAt),
    url: httpsOnly(c.url) ?? '',
  }
}
