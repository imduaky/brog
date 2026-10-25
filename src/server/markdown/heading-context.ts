import { headingToFileName } from '../../shared/paths.ts'

export interface HeadingContext {
  /** Heading texts from the outermost to the one containing the cursor. */
  headings: string[]
  /** Number of images between that heading and the cursor (0 for the first image). */
  imageIndex: number
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g

/**
 * Finds the heading chain and image position at `offset`, so a pasted image under
 * "## 开始 > ### 开始第一步" as the second image there becomes "开始-开始第一步_1.webp".
 */
export function headingContextAt(markdown: string, offset: number): HeadingContext {
  const before = markdown.slice(0, Math.max(0, Math.min(offset, markdown.length)))
  const stack: { level: number; text: string }[] = []
  let imageIndex = 0
  let fence: string | null = null
  for (const line of before.split('\n')) {
    const f = FENCE.exec(line)
    if (f) {
      if (!fence) fence = f[1]!
      else if (f[1]!.startsWith(fence[0]!) && f[1]!.length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    const h = ATX.exec(line)
    if (h) {
      const level = h[1]!.length
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, text: stripInline(h[2]!) })
      imageIndex = 0
      continue
    }
    imageIndex += line.match(IMAGE)?.length ?? 0
  }
  return { headings: stack.map((s) => s.text).filter(Boolean), imageIndex }
}

function stripInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '')
    .trim()
}

/** "开始-开始第一步_1" (without extension). Falls back to `fallback` outside any heading. */
export function imageBaseName(ctx: HeadingContext, fallback: string): string {
  const parts = ctx.headings.map(headingToFileName).filter(Boolean)
  const base = parts.length ? parts.join('-') : headingToFileName(fallback) || 'image'
  return base.slice(0, 100)
}
