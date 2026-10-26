import type { ColorPair } from './color.ts'

export type { ColorPair, Hex } from './color.ts'

/** Types shared by the server API and the web client. */

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface StatusEntry {
  path: string
  /** git porcelain v1 X column: ' ', M, A, D, U, ? */
  index: string
  /** git porcelain v1 Y column */
  worktree: string
}

export interface CommitInfo {
  oid: string
  parents: string[]
  author: string
  email: string
  /** Unix time in milliseconds */
  time: number
  subject: string
  body: string
}

export interface CommitDetail extends CommitInfo {
  files: { status: string; path: string }[]
  patch: string
}

/** <series>/meta.yaml */
export interface SeriesMeta {
  title: string
  description: string
  /** Repo-relative to the series folder, e.g. "cover.webp" */
  cover?: string
}

/** A tag from the predefined catalog. `key` is stable; `name` can change. */
export interface TagRef {
  key: string
  name: string
}

/** <series>/<n>/meta.yaml. Tags are stored by name. */
export interface ChapterMeta {
  title: string
  tags: string[]
  /** Relative to the chapter folder, e.g. "img/cover.webp" */
  cover?: string
  summary?: string
  /** Shown on home cards. Set by hand; falls back to the summary, then to the first paragraph. */
  preview?: ArticlePreview
}

export interface ArticlePreview {
  /** Text on the home card */
  text?: string
  /** Card tint, per mode */
  theme?: ColorPair
}

export interface TocItem {
  level: number
  id: string
  text: string
}

export interface ArticleRef {
  series: string
  chapter: number
  title: string
}

export interface ArticleSummary extends ArticleRef {
  seriesTitle: string
  summary: string
  tags: TagRef[]
  theme: ColorPair | null
  /** Public image URL */
  cover: string | null
  createdAt: number
  updatedAt: number
}

export interface SeriesSummary {
  slug: string
  title: string
  description: string
  cover: string | null
  chapters: ArticleRef[]
  updatedAt: number
}

export interface ArticleMetaResponse {
  series: { slug: string; title: string }
  chapter: number
  meta: Omit<ChapterMeta, 'tags'> & { tags: TagRef[]; coverUrl: string | null }
  /** Commit the content was read from */
  rev: string
  createdAt: number
  updatedAt: number
}

export interface ArticleContentResponse {
  html: string
  toc: TocItem[]
  rev: string
}

/** Everything a reader page needs, in one request. */
export interface ArticleBundle extends ArticleMetaResponse {
  content: ArticleContentResponse
  history: CommitInfo[]
  prev: ArticleRef | null
  next: ArticleRef | null
}

export interface FooterLink {
  label: string
  url: string
}

/** An entry on the friend links page. */
export interface FriendLink {
  name: string
  url: string
  description: string
  /** Image URL, optional */
  avatar: string
}

export type BuiltinPage = 'home' | 'series' | 'tags' | 'links'

/** One entry of the header navigation, in display order. */
export type NavItem =
  | { type: 'builtin'; page: BuiltinPage; label: string }
  /** A custom page from the repository's _pages/<slug>/ folder */
  | { type: 'page'; slug: string; label: string }
  /** An external address, opened in a new tab */
  | { type: 'link'; url: string; label: string }

export interface HomeBackground {
  /** Background color of the home page, per mode */
  color: ColorPair
}

/** Presentation settings, editable in the admin panel. */
export interface SiteSettings {
  title: string
  description: string
  footerText: string
  /** Small links in the footer (tool pages such as RSS or an about page) */
  footerLinks: FooterLink[]
  /** Shown on the friend links page */
  friendLinks: FriendLink[]
  /** Header navigation */
  nav: NavItem[]
  /** Show the anonymous clone command in the footer */
  showCloneUrl: boolean
  /** Article list layout: auto uses two columns when the page is wide enough */
  listColumns: 'auto' | 1 | 2
  /** Background of every page except the home page, per mode (the reading paper) */
  paper: ColorPair
  /** Home page background, per mode */
  home: HomeBackground
}

/** Server behaviour, edited in the admin panel. Address, port and data directory are startup options instead. */
export interface ServerSettings {
  /** Public origin, e.g. https://blog.example.com. Empty: taken from each request. */
  baseUrl: string
  /** Origin for share links, e.g. a short domain (https://s.example.com). Empty: the main site origin. */
  shareOrigin: string
  /** Read the client IP from X-Forwarded-For (only behind a reverse proxy) */
  trustProxy: boolean
  /** Origins of a separately deployed frontend allowed to call the API with cookies */
  corsOrigins: string[]
  /** Username for authenticated git clone/push */
  owner: string
  language: string
  sessionDays: number
  /** auto: Secure when baseUrl is https */
  cookieSecure: 'auto' | 'on' | 'off'
  cookieSameSite: 'strict' | 'lax' | 'none'
  /** Index article bodies for search. Off: titles, tags and summaries only. */
  fullText: boolean
  /** Commit author for web commits. Empty: the owner. */
  authorName: string
  authorEmail: string
}

export interface SiteInfo {
  settings: SiteSettings
  owner: string
  language: string
  /** Anonymous clone: published commit only */
  cloneUrl: string
  /** Authenticated clone/push (owner + token): full main including drafts */
  fullCloneUrl: string
  publishedCommit: string | null
  /** Published custom pages, for resolving page entries of the navigation */
  pages: PageRef[]
  /** Whether articles show a comment section (feature on, configured, and the token is set) */
  comments: { enabled: boolean }
}

/** The site icon: custom (uploaded) or the built-in default. */
export interface SiteIconInfo {
  custom: boolean
  /** Unix time in milliseconds; 0 for the default icon */
  updatedAt: number
}

/** A share link to an article: <origin>/sh/<id>, redirecting to the published article. */
export interface ShareLink {
  /** 4 letters or digits, case-sensitive */
  id: string
  url: string
  /** Unix time in milliseconds */
  createdAt: number
  /** The one link every reader of the article shares (created on the first request), not an admin's link */
  visitor: boolean
}

/** Comment settings as the admin sees them. */
export interface CommentSettings {
  /** The admin's switch, as saved */
  enabled: boolean
  /** On and configured with a token: readers see comments */
  active: boolean
  /** owner/name of the repository that holds the discussions */
  repo: string
  categoryId: string
  categoryName: string
  /** BROG_GITHUB_TOKEN is set in the environment (its value is never shown) */
  tokenConfigured: boolean
}

export interface CommentItem {
  id: string
  /** The name a reader typed, or the GitHub login of a comment written on GitHub */
  name: string
  /** Posted through the site by a reader, not by a GitHub account */
  guest: boolean
  avatarUrl: string | null
  body: string
  /** Unix time in milliseconds */
  createdAt: number
  url: string
}

export interface CommentsResponse {
  enabled: boolean
  /** Every comment on the article's discussion, including those not returned here */
  total: number
  /** Oldest first, up to 100 */
  comments: CommentItem[]
}

export interface CommentCategories {
  repoId: string
  categories: { id: string; name: string }[]
}

export interface CommentTestStep {
  key: 'token' | 'viewer' | 'repo' | 'category' | 'threads' | 'write'
  label: string
  /** null: not run, or nothing to check */
  ok: boolean | null
  detail: string
}

/** A custom page: _pages/<slug>/ holds content.md (Markdown) or index.html (a sandboxed web page). */
export interface PageRef {
  slug: string
  title: string
  kind: 'markdown' | 'html'
}

export interface PageResponse extends PageRef {
  /** Rendered Markdown, or for html pages the document shown in a sandboxed iframe */
  html: string
  toc: TocItem[]
  rev: string
}

export type PinKind = 'article' | 'series' | 'tag'

/** A pinned item as stored. key: "<series>/<n>" for articles, the slug for series, the tag key for tags. */
export interface Pin {
  kind: PinKind
  key: string
}

/** Pinned items resolved against the published index, in the admin's order. */
export type PinnedItem =
  | { kind: 'article'; key: string; article: ArticleSummary }
  | { kind: 'series'; key: string; series: SeriesSummary }
  | { kind: 'tag'; key: string; tag: TagCount }

/** Admin view of a pin: resolved title, or null when it is not published (or no longer exists). */
export interface AdminPin extends Pin {
  title: string | null
}

export interface SearchArticleHit {
  series: string
  chapter: number
  title: string
  seriesTitle: string
  tags: TagRef[]
  /** Matched text. \u0002 and \u0003 wrap the matched parts. */
  snippet: string
}

export interface SearchCommitHit extends CommitInfo {
  /** Articles touched by the commit, for linking */
  articles: ArticleRef[]
}

export interface SearchSeriesHit {
  slug: string
  title: string
  description: string
  count: number
}

/** Reader search: published articles, series and tags. Commit messages are searched in the admin panel. */
export interface SearchResponse {
  articles: SearchArticleHit[]
  series: SearchSeriesHit[]
  tags: TagCount[]
  /** Full-text indexing is off on this server; article search covers titles, tags and summaries only. */
  fullText: boolean
}

export interface SourceResponse {
  text: string
  rev: string
}

export interface CompareFile {
  path: string
  status: string
  additions: number
  deletions: number
  binary: boolean
  patch: string
}

export interface CompareResponse {
  base: CommitInfo
  head: CommitInfo
  files: CompareFile[]
  additions: number
  deletions: number
  /** The patch was cut at the server's size limit */
  truncated: boolean
}

export interface SessionInfo {
  admin: boolean
  expiresAt: number | null
}

export interface WorkspaceStatus {
  head: string
  published: string | null
  /** Commits on main that are not published yet */
  unpublished: CommitInfo[]
  changes: StatusEntry[]
  warning: string | null
}

export interface WorkspaceChapter {
  chapter: number
  title: string
  /** Has uncommitted changes */
  dirty: boolean
}

export interface WorkspaceSeries {
  slug: string
  title: string
  chapters: WorkspaceChapter[]
  dirty: boolean
}

/** Tag with the number of published articles that use it. Admin lists include zero-count tags. */
export interface TagCount extends TagRef {
  count: number
}

export interface GitTokenInfo {
  id: number
  name: string
  createdAt: number
  lastUsedAt: number | null
}

export interface ImageUploadResponse {
  /** Path relative to the chapter folder, to put into markdown */
  path: string
  url: string
  hash: string
}

export interface ApiErrorBody {
  error: string
}
