import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CompareResponse, SearchResponse, SiteInfo, SourceResponse, WorkspaceStatus } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

const MARK_START = '\u0002'

let t: TestServer
afterEach(async () => {
  await t.close()
})

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as T
}
const anon = (p: string) => fetch(t.url + p)

async function create(series: string, title: string) {
  return json<{ series: string; chapter: number }>(
    await t.api('/api/admin/chapters', { method: 'POST', json: { series, seriesTitle: series, title } }),
  )
}
const put = (path: string, content: string) => t.api('/api/admin/file', { method: 'PUT', json: { path, content } })
const commit = async (message: string) =>
  json<{ oid: string }>(await t.api('/api/admin/commit', { method: 'POST', json: { message, all: true } }))
const publish = async () => json<{ published: string }>(await t.api('/api/admin/publish', { method: 'POST' }))

describe('search', () => {
  beforeEach(async () => {
    t = await startServer()
    await t.login()
    const a = await create('alpha', 'Pointers')
    await put(`alpha/${a.chapter}/content.md`, '# Pointers\n\n指针保存内存地址。\n')
    const b = await create('alpha', 'Arrays')
    await put(`alpha/${b.chapter}/content.md`, '# Arrays\n\n数组名是首地址。\n')
    await commit('two chapters')
    await publish()
  })

  it('finds published body text with a 3+ character trigram match and marks it', async () => {
    const r = await json<SearchResponse>(await anon('/api/search?q=' + encodeURIComponent('指针保存')))
    expect(r.fullText).toBe(true)
    expect(r.articles.map((a) => a.title)).toEqual(['Pointers'])
    expect(r.articles[0]!.snippet).toContain(`${MARK_START}指针保存`)
  })

  it('falls back to a substring scan for 2-character queries', async () => {
    const r = await json<SearchResponse>(await anon('/api/search?q=' + encodeURIComponent('首地')))
    expect(r.articles.map((a) => a.title)).toEqual(['Arrays'])
  })

  it('does not find drafts that are not published', async () => {
    const d = await create('alpha', 'Draft')
    await put(`alpha/${d.chapter}/content.md`, 'zzqqxxdraftonly\n')
    await commit('draft')
    const r = await json<SearchResponse>(await anon('/api/search?q=zzqqxxdraftonly'))
    expect(r.articles).toEqual([])
  })

  it('re-indexes a chapter after it changes and publishes, and drops the old text', async () => {
    await put('alpha/1/content.md', '# Pointers\n\nhashtable replaces the old text.\n')
    await commit('rewrite')
    await publish()
    expect((await json<SearchResponse>(await anon('/api/search?q=' + encodeURIComponent('指针保存')))).articles).toEqual([])
    const hit = await json<SearchResponse>(await anon('/api/search?q=hashtable'))
    expect(hit.articles.map((a) => a.title)).toEqual(['Pointers'])
  })

  it('searches titles only when full-text indexing is off', async () => {
    const off = await startServer({ search: { fullText: false } })
    try {
      await off.login()
      const c = await json<{ series: string; chapter: number }>(
        await off.api('/api/admin/chapters', { method: 'POST', json: { series: 'beta', seriesTitle: 'beta', title: 'Gamma' } }),
      )
      await off.api('/api/admin/file', { method: 'PUT', json: { path: `beta/${c.chapter}/content.md`, content: 'Intro paragraph.\n\nbodyonlyword\n' } })
      await off.api('/api/admin/commit', { method: 'POST', json: { message: 'x', all: true } })
      await off.api('/api/admin/publish', { method: 'POST' })
      const body = await json<SearchResponse>(await fetch(off.url + '/api/search?q=bodyonlyword'))
      expect(body.fullText).toBe(false)
      expect(body.articles).toEqual([])
      const title = await json<SearchResponse>(await fetch(off.url + '/api/search?q=Gamma'))
      expect(title.articles.map((a) => a.title)).toEqual(['Gamma'])
    } finally {
      await off.close()
    }
  })

  it('finds commits by message: readers see published history only, the admin sees everything', async () => {
    await put('alpha/1/content.md', '# Pointers\n\nunpublished change\n')
    await commit('qqwwee unpublished subject')
    const pub = await json<SearchResponse>(await anon('/api/search?q=qqwwee'))
    expect(pub.commits).toEqual([])
    const adm = await json<SearchResponse>(await t.api('/api/search?q=qqwwee'))
    expect(adm.commits.map((c) => c.subject)).toEqual(['qqwwee unpublished subject'])
    expect(adm.commits[0]!.articles.map((a) => a.title)).toEqual(['Pointers'])
  })
})

describe('compare and source', () => {
  it('diffs two commits for the admin, restricts readers to published commits, and serves raw source', async () => {
    t = await startServer()
    await t.login()
    const a = await create('alpha', 'Pointers')
    await put(`alpha/${a.chapter}/content.md`, 'line one\n')
    const v1 = await commit('v1')
    await put(`alpha/${a.chapter}/content.md`, 'line one\nline two\n')
    const v2 = await commit('v2')
    await publish()

    const adm = await json<CompareResponse>(await t.api(`/api/compare?base=${v1.oid}&head=${v2.oid}`))
    expect(adm.files.map((f) => f.path)).toEqual([`alpha/${a.chapter}/content.md`])
    expect(adm.files[0]).toMatchObject({ status: 'M', additions: 1, deletions: 0, binary: false })
    expect(adm.files[0]!.patch).toContain('+line two')
    expect(adm.base.oid).toBe(v1.oid)

    const scoped = await json<CompareResponse>(await t.api(`/api/compare?base=${v1.oid}&head=${v2.oid}&path=${encodeURIComponent('alpha/' + a.chapter)}`))
    expect(scoped.files).toHaveLength(1)
    const none = await json<CompareResponse>(await t.api(`/api/compare?base=${v1.oid}&head=${v2.oid}&path=${encodeURIComponent('other/1')}`))
    expect(none.files).toEqual([])

    // Publish v2 first, so both ends are published for the reader check below.
    expect((await anon(`/api/compare?base=${v1.oid}&head=${v2.oid}`)).status).toBe(200)

    await put(`alpha/${a.chapter}/content.md`, 'draft only\n')
    const draft = await commit('draft')
    expect((await anon(`/api/compare?base=${v1.oid}&head=${draft.oid}`)).status).toBe(404)
    expect((await t.api(`/api/compare?base=${v1.oid}&head=${draft.oid}`)).status).toBe(200)

    const src = await json<SourceResponse>(await anon(`/api/articles/alpha/${a.chapter}/source`))
    expect(src.text).toBe('line one\nline two\n')
    expect(src.rev).toBe(v2.oid)
  })

  it('rejects malformed revisions and unsafe paths', async () => {
    t = await startServer()
    await t.login()
    expect((await anon('/api/compare?base=HEAD~1&head=HEAD')).status).toBe(400)
    expect((await t.api('/api/compare?base=HEAD&head=HEAD')).status).toBe(400)
    const a = await create('alpha', 'P')
    const c = await commit('c')
    expect((await t.api(`/api/compare?base=${c.oid}&head=${c.oid}&path=${encodeURIComponent('../etc')}`)).status).toBe(400)
    expect(a.chapter).toBe(1)
    await t.close()
    t = await startServer()
  })
})

describe('site settings', () => {
  it('uses the yaml title until an admin saves settings, then the saved values win', async () => {
    t = await startServer({ site: { owner: 'young', title: 'From YAML', description: 'd' } })
    await t.login()
    expect((await json<SiteInfo>(await anon('/api/site'))).settings.title).toBe('From YAML')
    const saved = await t.api('/api/admin/site-settings', {
      method: 'PUT',
      json: {
        title: 'Saved title',
        description: '',
        footerText: '© test',
        footerLinks: [{ label: 'GitHub', url: 'https://github.com/example' }],
        showCloneUrl: false,
        listColumns: 2,
        paper: { light: '#f4ecd8', dark: '#1f1c17' },
        home: { color: { light: '#f4ecd8', dark: '#1f1c17' } },
      },
    })
    expect(saved.status).toBe(200)
    const info = await json<SiteInfo>(await anon('/api/site'))
    expect(info.settings).toMatchObject({ title: 'Saved title', footerText: '© test', showCloneUrl: false, listColumns: 2 })
    expect(info.settings.footerLinks).toEqual([{ label: 'GitHub', url: 'https://github.com/example' }])
  })

  it('rejects javascript: and protocol-relative footer links', async () => {
    t = await startServer()
    await t.login()
    for (const url of ['javascript:alert(1)', '//evil.example', ' data:text/html,x']) {
      const r = await t.api('/api/admin/site-settings', {
        method: 'PUT',
        json: { title: 'x', description: '', footerText: '', footerLinks: [{ label: 'a', url }], showCloneUrl: true, listColumns: 1 },
      })
      expect(r.status, url).toBe(400)
    }
    const status = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(status.head).toBeTruthy()
  })
})
