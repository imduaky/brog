import type { MarkdownIt, StateBlock, StateCore, StateInline, Token } from 'markdown-it'
import { indentedBlockEnd, markerLine, tokenizeNested } from './indented.ts'

const ADMONITION = /^(!!!|\?\?\?\+?)\s+([A-Za-z][\w-]*)((?:\s+[A-Za-z][\w-]*)*)\s*(?:"(.*)")?\s*$/

/**
 * Admonitions:
 *   !!! note "Title"      static block
 *   ??? warning           collapsible, closed
 *   ???+ tip ""           collapsible, open, no title
 */
export function admonitionPlugin(md: MarkdownIt) {
  md.block.ruler.before(
    'fence',
    'admonition',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const line = markerLine(state, startLine)
      const m = line ? ADMONITION.exec(line) : null
      if (!m) return false
      if (silent) return true
      const [, marker, type, extra, title] = m
      const end = indentedBlockEnd(state, startLine, endLine)
      const collapsible = marker !== '!!!'
      const classes = ['admonition', type!.toLowerCase(), ...(extra ?? '').split(/\s+/).filter(Boolean)]

      const open = state.push('admonition_open', collapsible ? 'details' : 'div', 1)
      open.block = true
      open.map = [startLine, end]
      open.attrSet('class', classes.join(' '))
      if (marker === '???+') open.attrSet('open', '')
      open.meta = {
        collapsible,
        title: title ?? type!.charAt(0).toUpperCase() + type!.slice(1),
      }
      tokenizeNested(state, startLine + 1, end, 'admonition')
      const close = state.push('admonition_close', collapsible ? 'details' : 'div', -1)
      close.block = true
      state.line = end
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  // Collapsible bodies get their own wrapper so the client can animate its height.
  md.renderer.rules.admonition_open = (tokens, idx, _opts, _env, self) => {
    const t = tokens[idx]!
    const { collapsible, title } = t.meta as { collapsible: boolean; title: string }
    const titleHtml = renderTitle(md, title)
    const head = `<${t.tag}${self.renderAttrs(t)}>\n`
    // .details-body is the box the client animates; its padding lives in .details-content so the animated box has none.
    if (collapsible) return `${head}<summary>${titleHtml}</summary>\n<div class="details-body"><div class="details-content">\n`
    return title ? `${head}<p class="admonition-title">${titleHtml}</p>\n` : head
  }
  md.renderer.rules.admonition_close = (tokens, idx, _opts, _env) => {
    const t = tokens[idx]!
    // Only collapsible blocks (<details>) opened a .details-body wrapper.
    return t.tag === 'details' ? `</div></div>\n</${t.tag}>\n` : `</${t.tag}>\n`
  }
}

const TAB = /^===(!?)\s+"(.*)"\s*$/

/**
 * Content tabs:
 *   === "C"
 *       ```c ... ```
 *   === "Rust"
 *       ...
 * Consecutive tabs form one set; `===!` starts a new set.
 */
export function tabsPlugin(md: MarkdownIt) {
  md.block.ruler.before(
    'fence',
    'tab',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const line = markerLine(state, startLine)
      const m = line ? TAB.exec(line) : null
      if (!m) return false
      if (silent) return true
      const end = indentedBlockEnd(state, startLine, endLine)
      const open = state.push('tab_open', 'div', 1)
      open.block = true
      open.map = [startLine, end]
      open.meta = { label: m[2], newSet: m[1] === '!' }
      tokenizeNested(state, startLine + 1, end, 'tab')
      state.push('tab_close', 'div', -1).block = true
      state.line = end
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  // Mark the first/last tab of each set so the renderer can emit the wrapper.
  md.core.ruler.push('tab_sets', (state: StateCore) => {
    const tokens = state.tokens
    let setId = 0
    const stack: { set: number; index: number }[] = []
    let lastClose: { level: number; set: number; index: number } | null = null
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (t.type === 'tab_open') {
        const continues = lastClose && lastClose.level === t.level && !t.meta?.newSet && prevIsTabClose(tokens, i)
        const set = continues ? lastClose!.set : ++setId
        const index = continues ? lastClose!.index + 1 : 1
        t.meta = { ...t.meta, set, index, first: !continues }
        stack.push({ set, index })
      } else if (t.type === 'tab_close') {
        const cur = stack.pop()!
        t.meta = { ...cur, last: !nextIsContinuingTab(tokens, i) }
        lastClose = { level: t.level, ...cur }
      }
    }
  })

  md.renderer.rules.tab_open = (tokens, idx, _opts, env) => {
    const t = tokens[idx]!
    const { set, index, first, label } = t.meta as { set: number; index: number; first: boolean; label: string }
    const prefix = (env as { docId?: string }).docId ?? 'doc'
    const id = `tab-${prefix}-${set}-${index}`
    const name = `tabs-${prefix}-${set}`
    let out = first ? '<div class="tabbed-set">\n' : ''
    out += `<input type="radio" id="${id}" name="${name}"${first ? ' checked' : ''}>`
    out += `<label for="${id}">${renderTitle(md, label)}</label>\n<div class="tabbed-block">\n`
    return out
  }
  md.renderer.rules.tab_close = (tokens, idx) => ((tokens[idx]!.meta as { last: boolean }).last ? '</div>\n</div>\n' : '</div>\n')
}

/** Titles get their own env: the document env carries footnote and TOC state. */
function renderTitle(md: MarkdownIt, text: string): string {
  return md.renderInline(text, {})
}

function prevIsTabClose(tokens: Token[], i: number): boolean {
  return tokens[i - 1]?.type === 'tab_close'
}

function nextIsContinuingTab(tokens: Token[], i: number): boolean {
  const next = tokens[i + 1]
  return next?.type === 'tab_open' && !next.meta?.newSet && next.level === tokens[i]!.level
}

const KEY_NAMES: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  cmd: '⌘',
  command: '⌘',
  option: '⌥',
  opt: '⌥',
  meta: 'Meta',
  win: 'Win',
  enter: 'Enter',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  del: 'Del',
  delete: 'Delete',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

/** Keyboard keys: ++ctrl+alt+del++ */
export function keysPlugin(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'keys', (state: StateInline, silent: boolean) => {
    const src = state.src
    const start = state.pos
    if (!src.startsWith('++', start)) return false
    const close = src.indexOf('++', start + 2)
    if (close < 0) return false
    const body = src.slice(start + 2, close)
    if (!/^[\w-]+(\+[\w-]+)*$/.test(body)) return false
    if (!silent) {
      const t = state.push('keys', '', 0)
      t.meta = { keys: body.split('+') }
    }
    state.pos = close + 2
    return true
  })
  md.renderer.rules.keys = (tokens, idx) => {
    const keys = (tokens[idx]!.meta as { keys: string[] }).keys
    const parts = keys.map((k) => {
      const name = KEY_NAMES[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1))
      return `<kbd>${md.utils.escapeHtml(name)}</kbd>`
    })
    return `<span class="keys">${parts.join('<span>+</span>')}</span>`
  }
}
