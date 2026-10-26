import path from 'node:path/posix'
import { abbr } from '@mdit/plugin-abbr'
import { attrs } from '@mdit/plugin-attrs'
import { dl } from '@mdit/plugin-dl'
import { footnote } from '@mdit/plugin-footnote'
import { katex } from '@mdit/plugin-katex'
import { mark } from '@mdit/plugin-mark'
import { sub } from '@mdit/plugin-sub'
import { sup } from '@mdit/plugin-sup'
import { tasklist } from '@mdit/plugin-tasklist'
import markdownit, { type MarkdownIt, type Token } from 'markdown-it'
import anchor from 'markdown-it-anchor'
import { type BundledLanguage, bundledLanguages, createHighlighter, type Highlighter, type ShikiTransformer } from 'shiki'
import type { TocItem } from '../../shared/types.ts'
import { admonitionPlugin, keysPlugin, tabsPlugin } from './containers.ts'
import { sanitize } from './sanitize.ts'

export interface RenderContext {
  /** Repo path of the chapter folder, e.g. "<series>/2" */
  baseDir: string
  /** Repo path -> public URL for images and other binary assets. */
  resolveAsset(repoPath: string): string | null
  /** Repo path -> text, used to inline `src="js/x.js"` into live demos. */
  readText(repoPath: string): string | null
  /** Unique per rendered document, keeps generated ids distinct. */
  docId?: string
}

export interface RenderResult {
  html: string
  toc: TocItem[]
  /** Plain text of the first paragraph, used when meta.yaml has no summary. */
  summary: string
}

interface Env extends RenderContext {
  toc: TocItem[]
  [key: string | symbol]: unknown
}

const envOf = (env: unknown) => env as Env

const THEMES = { light: 'github-light', dark: 'github-dark' } as const
let highlighter: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [] })
  return highlighter
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFC')
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  )
}

/** Parse `lang key="value" flag` from a fence info string. */
export function parseFenceInfo(info: string): { lang: string; attrs: Record<string, string> } {
  const trimmed = info.trim()
  const space = trimmed.search(/\s/)
  const lang = (space < 0 ? trimmed : trimmed.slice(0, space)).replace(/^\{?\.?/, '').replace(/\}$/, '')
  const rest = space < 0 ? '' : trimmed.slice(space)
  const attrs: Record<string, string> = {}
  for (const m of rest.matchAll(/([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g)) {
    attrs[m[1]!] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return { lang: lang.toLowerCase(), attrs }
}

function parseLineSet(spec: string | undefined): Set<number> {
  const set = new Set<number>()
  for (const part of (spec ?? '').split(/[\s,]+/).filter(Boolean)) {
    const [a, b] = part.split('-').map(Number)
    if (!a) continue
    for (let n = a; n <= (b ?? a) && n - a < 10_000; n++) set.add(n)
  }
  return set
}

const isRelative = (url: string) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)

function safeDecode(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

function createMarkdown(hl: Highlighter): MarkdownIt {
  const md = markdownit({ html: true, linkify: true, typographer: false })
  md.use(admonitionPlugin)
    .use(tabsPlugin)
    .use(keysPlugin)
    .use(footnote)
    .use(tasklist, { disabled: true })
    .use(mark)
    .use(sub)
    .use(sup)
    .use(abbr)
    .use(dl)
    .use(attrs)
    .use(katex, { delimiters: 'dollars', allowInlineWithSpace: false })
    .use(anchor, {
      slugify,
      level: [1, 2, 3, 4, 5, 6],
      permalink: anchor.permalink.linkInsideHeader({ symbol: '#', placement: 'after', ariaHidden: true, class: 'headerlink' }),
      callback: (token: Token, info: { slug: string; title: string }) => {
        // The env is not passed to callbacks; collected in the core rule below instead.
        token.meta = { ...token.meta, slug: info.slug, title: info.title }
      },
    })

  md.core.ruler.push('collect_toc', (state) => {
    const env = envOf(state.env)
    env.toc = []
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i]!
      if (t.type === 'heading_open' && t.meta?.slug) {
        env.toc.push({ level: Number(t.tag.slice(1)), id: String(t.meta.slug), text: String(t.meta.title) })
      }
    }
  })

  // Relative image paths -> /images/{hash}; relative links to content.md -> reader URL.
  const defaultImage = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]!
    const src = String(t.attrGet('src') ?? '')
    if (isRelative(src)) {
      const ctx = envOf(env)
      const repoPath = path.normalize(path.join(ctx.baseDir, safeDecode(src)))
      t.attrSet('src', ctx.resolveAsset(repoPath) ?? src)
    }
    t.attrSet('loading', 'lazy')
    t.attrSet('decoding', 'async')
    return defaultImage(tokens, idx, opts, env, self)
  }
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]!
    const href = String(t.attrGet('href') ?? '')
    if (isRelative(href)) {
      t.attrSet('href', href.replace(/(^|\/)content\.md(#|$)/, '$1$2').replace(/\/$/, '') || '.')
    } else if (/^https?:/i.test(href)) {
      t.attrSet('target', '_blank')
      t.attrSet('rel', 'noopener noreferrer')
    }
    return defaultLink(tokens, idx, opts, env, self)
  }

  // Source line of every top-level block, so the editor can scroll the preview to match.
  md.core.ruler.push('source_lines', (state) => {
    for (const t of state.tokens) {
      if (t.block && t.map && t.nesting !== -1) t.attrSet('data-line', String(t.map[0] + 1))
    }
  })

  md.renderer.rules.fence = (tokens, idx, _opts, env) => {
    const t = tokens[idx]!
    const { lang, attrs } = parseFenceInfo(t.info)
    const code = t.content
    const line = t.map ? ` data-line="${t.map[0] + 1}"` : ''
    if (lang === 'mermaid') return `<pre class="mermaid"${line}>${md.utils.escapeHtml(code)}</pre>\n`
    if ('live' in attrs && (lang === 'js' || lang === 'javascript' || lang === 'html')) {
      return renderLiveDemo(md, hl, envOf(env), lang === 'html' ? 'html' : 'js', code, attrs, line)
    }
    return renderCode(md, hl, code, lang, attrs, line)
  }
  return md
}

function renderCode(md: MarkdownIt, hl: Highlighter, code: string, lang: string, attrs: Record<string, string>, extra = ''): string {
  const highlight = parseLineSet(attrs.hl_lines)
  const start = Number(attrs.linenums) || 1
  const transformer: ShikiTransformer = {
    pre(node) {
      if ('linenums' in attrs) {
        this.addClassToHast(node, 'linenums')
        node.properties.style = `${node.properties.style ?? ''};counter-reset:line ${start - 1}`
      }
    },
    line(node, line) {
      if (highlight.has(line)) this.addClassToHast(node, 'hl')
    },
  }
  const loaded = hl.getLoadedLanguages().includes(lang)
  const html = hl.codeToHtml(code.replace(/\n$/, ''), {
    lang: loaded ? lang : 'text',
    themes: THEMES,
    defaultColor: false,
    transformers: [transformer],
  })
  const title = attrs.title ? `<div class="code-title">${md.utils.escapeHtml(attrs.title)}</div>` : ''
  return `<div class="code-block" data-lang="${md.utils.escapeHtml(lang)}"${extra}>${title}${html}</div>\n`
}

/** Runs inside a sandboxed iframe (opaque origin): reports its height to the parent page. */
const DEMO_BOOTSTRAP = `<script>(function(){var s=function(){parent.postMessage({type:"brog-demo-height",height:document.documentElement.scrollHeight},"*")};new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s)})()</script>`
const DEMO_STYLE = `<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;font-size:15px}body{margin:12px}</style>`

/**
 * A custom HTML page, prepared for a sandboxed iframe: the height reporter goes first
 * in <head> (or the page is wrapped when it has none). The page itself is not filtered;
 * the sandbox (scripts only, opaque origin) is what isolates it from the site.
 */
export function sandboxDocument(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${DEMO_BOOTSTRAP}`)
  return `<!doctype html><html><head><meta charset="utf-8">${DEMO_BOOTSTRAP}</head><body>${html}</body></html>`
}

function renderLiveDemo(
  md: MarkdownIt,
  hl: Highlighter,
  env: Env,
  kind: 'js' | 'html',
  inline: string,
  attrs: Record<string, string>,
  extra = '',
): string {
  let code = inline
  if (attrs.src && isRelative(attrs.src)) {
    const repoPath = path.normalize(path.join(env.baseDir, attrs.src))
    code = env.readText(repoPath) ?? `// ${attrs.src} not found`
  }
  const body =
    kind === 'html'
      ? code
      : `<div id="app"></div><script>${code.replace(/<\/script/gi, '<\\/script')}</script>`
  const doc = `<!doctype html><html><head><meta charset="utf-8">${DEMO_STYLE}${DEMO_BOOTSTRAP}</head><body>${body}</body></html>`
  const height = Math.min(Math.max(Number(attrs.height) || 160, 40), 2000)
  const title = attrs.title ?? (attrs.src ? path.basename(attrs.src) : 'Live demo')
  const source = renderCode(md, hl, code, kind === 'html' ? 'html' : 'js', {})
  return (
    `<figure class="live-demo"${extra}>` +
    `<iframe class="live-demo-frame" sandbox="allow-scripts" title="${md.utils.escapeHtml(title)}" loading="lazy" style="height:${height}px" srcdoc="${md.utils.escapeHtml(doc)}"></iframe>` +
    `<details class="live-demo-source"><summary>${md.utils.escapeHtml(title)} · 源码</summary><div class="details-body"><div class="details-content">${source}</div></div></details>` +
    `</figure>\n`
  )
}

let mdInstance: Promise<{ md: MarkdownIt; hl: Highlighter }> | null = null
function getMarkdown() {
  mdInstance ??= getHighlighter().then((hl) => ({ md: createMarkdown(hl), hl }))
  return mdInstance
}

/** Languages used by fences that the highlighter has not loaded yet. */
async function loadFenceLanguages(hl: Highlighter, tokens: Token[]) {
  const loaded = new Set(hl.getLoadedLanguages())
  const wanted = new Set<string>()
  const walk = (list: Token[]) => {
    for (const t of list) {
      if (t.type === 'fence') {
        const { lang, attrs } = parseFenceInfo(t.info)
        if ('live' in attrs) wanted.add(lang === 'html' ? 'html' : 'js')
        else if (lang && !loaded.has(lang) && lang in bundledLanguages) wanted.add(lang)
      }
      if (t.children) walk(t.children)
    }
  }
  walk(tokens)
  const missing = [...wanted].filter((l) => !loaded.has(l))
  if (missing.length) await hl.loadLanguage(...(missing as BundledLanguage[]))
}

export async function renderMarkdown(source: string, ctx: RenderContext): Promise<RenderResult> {
  const { md, hl } = await getMarkdown()
  const env: Env = { ...ctx, toc: [] }
  const tokens = md.parse(source, env)
  await loadFenceLanguages(hl, tokens)
  const html = sanitize(md.renderer.render(tokens, md.options, env))
  return { html, toc: env.toc, summary: firstParagraph(tokens) }
}

function firstParagraph(tokens: Token[]): string {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type === 'paragraph_open' && tokens[i]!.level === 0) {
      const inline = tokens[i + 1]
      const text = (inline?.children ?? [])
        .filter((c) => c.type === 'text' || c.type === 'code_inline')
        .map((c) => c.content)
        .join('')
        .trim()
      if (text) return text.length > 200 ? `${text.slice(0, 200)}…` : text
    }
  }
  return ''
}
