import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_README } from '../src/server/content/seed/readme.ts'
import type { ArticleSummary, SeriesSummary } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

let t: TestServer
beforeEach(async () => {
  t = await startServer()
})
afterEach(async () => {
  await t.close()
})

describe('example content', () => {
  it('embeds the project README exactly', () => {
    const readme = readFileSync(path.resolve(import.meta.dirname, '..', 'README.md'), 'utf8')
    expect(PROJECT_README).toBe(readme)
  })

  it('is published on a fresh install and listed on the home page', async () => {
    const list = await (await fetch(t.url + '/api/articles')).json() as ArticleSummary[]
    expect(list.map((a) => a.title)).toEqual(['示例：Markdown 全部功能'])
    const series = await (await fetch(t.url + '/api/series')).json() as SeriesSummary[]
    expect(series.map((s) => s.slug)).toEqual(['示例'])
  })

  it('starts with the project README and then renders every Markdown feature', async () => {
    const r = await (await fetch(t.url + '/api/articles/' + encodeURIComponent('示例') + '/1/content')).json() as { html: string; toc: { text: string }[] }
    const html = r.html
    // the README comes first
    expect(html.indexOf('<h1 id="brog"')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('<h1 id="brog"')).toBeLessThan(html.indexOf('Markdown 全部扩展语法'))

    const checks: [string, RegExp][] = [
      ['admonition note', /class="admonition note"/],
      ['admonition tip (default title)', /class="admonition tip"[^>]*>\s*<p class="admonition-title">Tip<\/p>/],
      ['admonition warning', /class="admonition warning"/],
      ['admonition danger', /class="admonition danger"/],
      ['collapsed block', /<details class="admonition info"[^>]*>/],
      ['open collapsed block', /<details class="admonition question" open/],
      ['content tabs', /class="tabbed-set"/],
      ['code title and line numbers', /data-lang="c"[^>]*><div class="code-title">hello\.c<\/div>[\s\S]*linenums/],
      ['highlighted line', /class="line hl"/],
      ['keyboard keys', /<span class="keys"><kbd>Ctrl<\/kbd>/],
      ['mark', /<mark>高亮的文字<\/mark>/],
      ['subscript', /H<sub>2<\/sub>O/],
      ['superscript', /mc<sup>2<\/sup>/],
      ['katex inline', /class="katex"/],
      ['katex display', /class="katex-display"/],
      ['footnotes', /class="footnotes"/],
      ['task list', /class="task-list-item"/],
      ['table', /<table[ >]/],
      ['strikethrough', /<s>删除线<\/s>/],
      ['abbreviation', /<abbr title="HyperText Markup Language">HTML<\/abbr>/],
      ['definition list', /<dl[ >]/],
      ['mermaid diagram', /<pre class="mermaid"/],
      ['image from the chapter folder', /<img src="\/images\/[0-9a-f]{32}" alt="流程示意"/],
      ['live demo with inline source', /class="live-demo"[\s\S]*srcdoc=/],
      ['live demo with a referenced script', /<summary>random\.js · 源码<\/summary>/],
      ["attribute class", /<p class="lead"/],
      ['allowed raw html survives sanitizing', /<kbd>Esc<\/kbd>/],
    ]
    for (const [label, re] of checks) expect(html, label).toMatch(re)
    // no executable script reaches the page (the one in the demo is only shown as code)
    expect(html).not.toMatch(/<script(?![^>]*srcdoc)/)

    // the referenced script is the one in the folder, and it runs inside the sandbox
    expect(html).toContain('随机数：')
    expect(html).toContain('sandbox="allow-scripts"')
    // the README's own sections come before the demo
    expect(r.toc.map((x) => x.text)).toContain('Markdown 全部扩展语法')
  })

  it('serves the chapter source as written', async () => {
    const r = await (await fetch(t.url + '/api/articles/' + encodeURIComponent('示例') + '/1/source')).json() as { text: string }
    expect(r.text.startsWith('# brog')).toBe(true)
    expect(r.text).toContain('```js live height="120"')
  })
})
