import type { StateBlock } from 'markdown-it'

/**
 * Helper for mkdocs-style containers: a marker line followed by content indented
 * by four spaces. Returns the line after the last content line (exclusive end).
 */
export function indentedBlockEnd(state: StateBlock, startLine: number, endLine: number): number {
  let next = startLine + 1
  while (next < endLine) {
    if (state.isEmpty(next)) {
      next++
      continue
    }
    if (state.sCount[next]! - state.blkIndent < 4) break
    next++
  }
  // Trailing blank lines belong to the surrounding document.
  while (next > startLine + 1 && state.isEmpty(next - 1)) next--
  return next
}

/** Tokenize lines [start, end) as block content nested 4 columns deeper. */
export function tokenizeNested(state: StateBlock, start: number, end: number, parentType: string) {
  const oldParent = state.parentType
  const oldIndent = state.blkIndent
  // markdown-it's own types are a closed union; containers need their own name.
  state.parentType = parentType as typeof state.parentType
  state.blkIndent += 4
  state.md.block.tokenize(state, start, end)
  state.blkIndent = oldIndent
  state.parentType = oldParent
}

export function markerLine(state: StateBlock, line: number): string | null {
  if (state.sCount[line]! - state.blkIndent >= 4) return null
  const pos = state.bMarks[line]! + state.tShift[line]!
  return state.src.slice(pos, state.eMarks[line])
}
