import { describe, expect, it } from 'vitest'
import { headingContextAt, imageBaseName } from '../src/server/markdown/heading-context.ts'
import { renderMarkdown } from '../src/server/markdown/render.ts'

const ctx = { baseDir: 'S/1', resolveAsset: (p: string) => `/images/${p}`, readText: () => 'console.log(1)' }

describe('markdown', () => {
  it('renders admonitions, collapsible blocks and tabs', async () => {
    const { html } = await renderMarkdown(
      '!!! note "标题"\n    正文\n\n??? tip\n    折叠\n\n=== "A"\n    a\n\n=== "B"\n    b\n',
      ctx,
    )
    expect(html).toContain('<div class="admonition note" data-line="1">')
    expect(html).toContain('<p class="admonition-title">标题</p>')
    expect(html).toMatch(/<details class="admonition tip"[^>]*>\s*<summary>Tip<\/summary>\s*<div class="details-body">/)
    expect(html.match(/class="tabbed-set"/g)).toHaveLength(1)
    expect(html.match(/type="radio"/g)).toHaveLength(2)
  })

  it('builds a toc and rewrites relative images', async () => {
    const r = await renderMarkdown('# A\n\n## B 子标题\n\n![x](img/a.webp)\n', ctx)
    expect(r.toc).toEqual([
      { level: 1, id: 'a', text: 'A' },
      { level: 2, id: 'b-子标题', text: 'B 子标题' },
    ])
    expect(r.html).toContain('src="/images/S/1/img/a.webp"')
  })

  it('sanitizes raw html and sandboxes live demos', async () => {
    const { html } = await renderMarkdown(
      '<script>alert(1)</script><img src=x onerror="alert(1)">\n\n```js live src="js/a.js"\n```\n',
      ctx,
    )
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('onerror')
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('console.log(1)')
  })
})

describe('image naming', () => {
  it('joins the heading chain and counts images in the section', () => {
    const md = '# 开始\n\n## 开始第一步\n\n![](a.png)\n\n```\n# not a heading\n![](b.png)\n```\n'
    const c = headingContextAt(md, md.length)
    expect(c.headings).toEqual(['开始', '开始第一步'])
    expect(c.imageIndex).toBe(1)
    expect(imageBaseName(c, 'x')).toBe('开始-开始第一步')
  })

  it('pops sibling headings', () => {
    const md = '# A\n## B\n### C\n## D\n'
    expect(headingContextAt(md, md.length).headings).toEqual(['A', 'D'])
  })
})
