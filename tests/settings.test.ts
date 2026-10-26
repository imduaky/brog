import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStartup } from '../src/server/config.ts'
import type { AdminPin, PageResponse, PinnedItem, ServerSettings, SiteInfo } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

let t: TestServer | null = null
afterEach(async () => {
  await t?.close()
  t = null
})

const json = async <T>(r: Response | Promise<Response>) => (await r).json() as Promise<T>

async function publishFile(s: TestServer, file: string, content: string) {
  await s.api('/api/admin/file', { method: 'PUT', json: { path: file, content } })
  await s.api('/api/admin/commit', { method: 'POST', json: { message: `add ${file}`, all: true } })
  await s.api('/api/admin/publish', { method: 'POST' })
}

describe('startup options', () => {
  it('takes flags over environment variables over defaults', () => {
    const s = resolveStartup({ port: '9000' }, { BROG_PORT: '7000', BROG_HOST: '127.0.0.1', BROG_SERVE_WEB: 'false' }, '/srv')
    expect(s).toMatchObject({ host: '127.0.0.1', port: 9000, serveWeb: false, dataDir: '/srv/data' })
    expect(() => resolveStartup({ port: 'x' }, {})).toThrow()
    expect(resolveStartup({}, { BROG_TRUST_PROXY: '1' }).trustProxy).toBe(true)
    expect(resolveStartup({}, {}).trustProxy).toBe(false)
  })
})

describe('server settings', () => {
  it('are edited by the admin and apply without a restart', async () => {
    t = await startServer()
    expect((await t.api('/api/admin/server-settings')).status).toBe(401)
    await t.login()
    const current = await json<ServerSettings>(t.api('/api/admin/server-settings'))
    expect(current.owner).toBe('young')
    const next = { ...current, owner: 'writer', language: 'en', baseUrl: 'https://blog.test/' }
    const saved = await json<ServerSettings>(t.api('/api/admin/server-settings', { method: 'PUT', json: next }))
    expect(saved.baseUrl).toBe('https://blog.test')
    const site = await json<SiteInfo>(fetch(`${t.url}/api/site`))
    expect(site).toMatchObject({ owner: 'writer', language: 'en', cloneUrl: 'https://blog.test/git/blog.git' })
  })

  it('reject combinations that would break login', async () => {
    t = await startServer()
    await t.login()
    const current = await json<ServerSettings>(t.api('/api/admin/server-settings'))
    for (const bad of [
      { cookieSameSite: 'none', cookieSecure: 'off' },
      { owner: 'has space' },
      { corsOrigins: ['https://a.test/path'] },
      { sessionDays: 0 },
    ]) {
      const r = await t.api('/api/admin/server-settings', { method: 'PUT', json: { ...current, ...bad } })
      expect(r.status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('switching full-text search re-indexes the published articles', async () => {
    t = await startServer()
    await t.login()
    const c = await json<{ chapter: number }>(
      t.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'First' } }),
    )
    await publishFile(t, `alpha/${c.chapter}/content.md`, 'Intro.\n\nzzbodyword\n')
    const search = () => json<{ articles: unknown[] }>(fetch(`${t!.url}/api/search?q=zzbodyword`))
    expect((await search()).articles).toHaveLength(1)
    const current = await json<ServerSettings>(t.api('/api/admin/server-settings'))
    await t.api('/api/admin/server-settings', { method: 'PUT', json: { ...current, fullText: false } })
    await expect.poll(async () => (await search()).articles.length).toBe(0)
    await t.api('/api/admin/server-settings', { method: 'PUT', json: { ...current, fullText: true } })
    await expect.poll(async () => (await search()).articles.length).toBe(1)
  })
})

describe('site settings sections', () => {
  it('saves one section without touching the others, and validates links and navigation', async () => {
    t = await startServer()
    await t.login()
    const put = (json: unknown) => t!.api('/api/admin/site-settings', { method: 'PUT', json })
    expect((await put({ footerText: 'f' })).status).toBe(200)
    const friend = { name: 'A', url: 'https://a.test', description: '', avatar: '' }
    expect((await put({ friendLinks: [friend] })).status).toBe(200)
    const site = await json<SiteInfo>(fetch(`${t.url}/api/site`))
    expect(site.settings.footerText).toBe('f')
    expect(site.settings.friendLinks).toEqual([friend])
    expect(site.settings.nav.map((n) => n.label)).toEqual(['文章', '合集', '标签', '友链'])

    expect((await put({ friendLinks: [{ ...friend, url: 'javascript:alert(1)' }] })).status).toBe(400)
    expect((await put({ friendLinks: [{ ...friend, avatar: '//evil.test/a.png' }] })).status).toBe(400)
    expect((await put({ nav: [{ type: 'link', label: 'x', url: '/local' }] })).status).toBe(400)
    expect((await put({ nav: [{ type: 'page', label: 'x', slug: '../x' }] })).status).toBe(400)
    expect((await put({ nav: [{ type: 'page', label: 'About', slug: 'about' }, { type: 'link', label: 'GH', url: 'https://gh.test' }] })).status).toBe(200)
  })
})

describe('pins', () => {
  it('lists published targets in the admin order and skips the rest', async () => {
    t = await startServer()
    await t.login()
    const c = await json<{ chapter: number }>(
      t.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'First', tags: ['topic'] } }),
    )
    await publishFile(t, `alpha/${c.chapter}/content.md`, 'Body.\n')
    const tags = await json<{ key: string; name: string }[]>(t.api('/api/admin/tags'))
    const topic = tags.find((x) => x.name === 'topic')!
    const pins = [
      { kind: 'tag', key: topic.key },
      { kind: 'article', key: 'alpha/1' },
      { kind: 'series', key: 'alpha' },
      { kind: 'article', key: 'alpha/9' },
    ]
    expect((await fetch(`${t.url}/api/admin/pins`)).status).toBe(401)
    const admin = await json<AdminPin[]>(t.api('/api/admin/pins', { method: 'PUT', json: { pins } }))
    expect(admin.map((p) => p.title)).toEqual(['topic', 'First', 'alpha', null])
    const pub = await json<PinnedItem[]>(fetch(`${t.url}/api/pins`))
    expect(pub.map((p) => `${p.kind}:${p.key}`)).toEqual([`tag:${topic.key}`, 'article:alpha/1', 'series:alpha'])
    expect((await t.api('/api/admin/pins', { method: 'PUT', json: { pins: [{ kind: 'other', key: 'x' }] } })).status).toBe(400)
  })
})

describe('custom pages', () => {
  it('are created in _pages/, visible to readers only after publishing, and html pages stay sandboxed', async () => {
    t = await startServer()
    await t.login()
    const md = await t.api('/api/admin/pages', { method: 'POST', json: { slug: 'about', title: 'About', kind: 'markdown' } })
    expect(md.status).toBe(200)
    expect((await t.api('/api/admin/pages', { method: 'POST', json: { slug: 'about', title: 'Again', kind: 'markdown' } })).status).toBe(409)
    expect((await t.api('/api/admin/pages', { method: 'POST', json: { slug: '../x', title: 'x', kind: 'markdown' } })).status).toBe(400)
    await t.api('/api/admin/pages', { method: 'POST', json: { slug: 'tool', title: 'Tool', kind: 'html' } })
    expect((await fetch(`${t.url}/api/pages/about`)).status).toBe(404)

    await t.api('/api/admin/file', { method: 'PUT', json: { path: '_pages/tool/index.html', content: '<html><head></head><body><script>1</script></body></html>' } })
    await publishFile(t, '_pages/about/content.md', '# About\n\n!!! note "Hi"\n    Text\n')
    const about = await json<PageResponse>(fetch(`${t.url}/api/pages/about`))
    expect(about).toMatchObject({ slug: 'about', title: 'About', kind: 'markdown' })
    expect(about.html).toContain('admonition')
    const tool = await json<PageResponse>(fetch(`${t.url}/api/pages/tool`))
    expect(tool.kind).toBe('html')
    expect(tool.html).toContain('brog-demo-height')
    expect(tool.html).toContain('<script>1</script>')

    const site = await json<SiteInfo>(fetch(`${t.url}/api/site`))
    expect(site.pages.map((p) => p.slug)).toEqual(['about', 'tool'])
    // _pages is never a series
    const series = await json<{ slug: string }[]>(fetch(`${t.url}/api/series`))
    expect(series.map((s) => s.slug)).not.toContain('_pages')
    expect((await t.api('/api/admin/chapters', { method: 'POST', json: { series: '_x', title: 'x' } })).status).toBe(400)
  })
})
