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

export interface HomeBackground {
  /** Background color of the home page, per mode */
  color: ColorPair
}

/** Presentation settings, editable in the admin panel. */
export interface SiteSettings {
  title: string
  description: string
  footerText: string
  footerLinks: FooterLink[]
  /** Show the anonymous clone command in the footer */
  showCloneUrl: boolean
  /** Article list layout: auto uses two columns when the page is wide enough */
  listColumns: 'auto' | 1 | 2
  /** Background of every page except the home page, per mode (the reading paper) */
  paper: ColorPair
  /** Home page background, per mode */
  home: HomeBackground
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

export interface SearchResponse {
  articles: SearchArticleHit[]
  commits: SearchCommitHit[]
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
