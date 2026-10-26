/**
 * Repository layout:
 *
 *   <series>/meta.yaml            series title / description / cover
 *   <series>/<n>/meta.yaml        chapter title / tags / cover / summary
 *   <series>/<n>/content.md       chapter body
 *   <series>/<n>/img/*.webp       images (named after the heading they belong to)
 *   <series>/<n>/js/*.js          scripts for live demos
 *   _pages/<slug>/meta.yaml       custom page title
 *   _pages/<slug>/content.md      custom Markdown page (or index.html for a sandboxed web page)
 *
 * Top-level names starting with "_" are reserved for site files, so they are never series.
 */
export const CONTENT_FILE = 'content.md'
export const META_FILE = 'meta.yaml'
export const IMG_DIR = 'img'
export const JS_DIR = 'js'
export const PAGES_DIR = '_pages'
export const PAGE_HTML_FILE = 'index.html'

const BAD_SEGMENT = /[\u0000-\u001f\u007f/\\:*?"<>|]/

/** A single path segment that is safe on every filesystem and inside a URL. */
export function isSafeSegment(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 120 &&
    !name.startsWith('.') &&
    name.trim() === name &&
    !BAD_SEGMENT.test(name)
  )
}

export function isSeriesSlug(name: string): boolean {
  return isSafeSegment(name) && !name.startsWith('_')
}

/** Custom page folder name; also its URL (/p/<slug>). */
export function isPageSlug(name: string): boolean {
  return isSafeSegment(name) && name.length <= 60 && !/[\s#%?]/.test(name)
}

export function isChapterNumber(name: string): boolean {
  return /^[1-9][0-9]{0,5}$/.test(name)
}

/** Normalize a workspace-relative path; returns null when it escapes the root or hits .git. */
export function normalizeRepoPath(p: string): string | null {
  const parts = p.split('/').filter((s) => s.length > 0)
  if (parts.length === 0) return null
  for (const s of parts) {
    if (s === '.' || s === '..' || !isSafeSegment(s)) return null
  }
  return parts.join('/')
}

export function chapterDir(series: string, chapter: number): string {
  return `${series}/${chapter}`
}

/** Turn a heading into a file-name fragment: keep letters/digits/CJK, collapse the rest. */
export function headingToFileName(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|#%&{}$!'`@=+^~[\]]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60)
}
