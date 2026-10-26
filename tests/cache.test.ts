import { afterEach, describe, expect, it } from 'vitest'
import { CACHE } from '../src/server/routes/public.ts'
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

async function setup(): Promise<{ chapter: number; head: string }> {
  await t!.login()
  const c = await json<{ chapter: number }>(t!.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'First' } }))
  await publishFile(t!, `alpha/${c.chapter}/content.md`, 'Body.\n')
  const status = await json<{ head: string }>(t!.api('/api/admin/status'))
  return { chapter: c.chapter, head: status.head }
}

const headers = async (url: string, init?: RequestInit) => (await fetch(url, init)).headers

describe('CDN cache policy', () => {
  it('lists and latest-version pages are shared for a minute, not stored by browsers beyond revalidation', async () => {
    t = await startServer()
    const { chapter } = await setup()
    for (const path of ['/api/site', '/api/pins', '/api/articles', '/api/series', '/api/tags', '/api/search?q=Body', `/api/articles/alpha/${chapter}`, `/api/articles/alpha/${chapter}/meta`, `/api/articles/alpha/${chapter}/history`, `/api/articles/alpha/${chapter}/content`, `/api/articles/alpha/${chapter}/source`]) {
      expect((await headers(t.url + path)).get('cache-control'), path).toBe(CACHE.live)
    }
  })

  it('a fixed revision is cacheable for a year and immutable', async () => {
    t = await startServer()
    const { chapter, head } = await setup()
    for (const path of [`/api/articles/alpha/${chapter}/content?rev=${head}`, `/api/articles/alpha/${chapter}/source?rev=${head}`]) {
      expect((await headers(t.url + path)).get('cache-control'), path).toBe(CACHE.fixed)
    }
    expect((await headers(`${t.url}/api/compare?base=${head}&head=${head}`)).get('cache-control')).toBe(CACHE.fixed)
  })

  it('comments and share links are never served stale', async () => {
    t = await startServer()
    const { chapter } = await setup()
    expect((await headers(`${t.url}/api/comments/alpha/${chapter}`)).get('cache-control')).toBe(CACHE.fresh)
    expect((await headers(`${t.url}/api/articles/alpha/${chapter}/share`)).get('cache-control')).toBe(CACHE.fresh)
    const post = await headers(`${t.url}/api/articles/alpha/${chapter}/share`, { method: 'POST', headers: { 'x-brog-request': '1' } })
    expect(post.get('cache-control')).toBe(CACHE.fresh)
  })

  it('an admin compare is private: a shared cache must not store it', async () => {
    t = await startServer()
    const { head } = await setup()
    const r = await t.api(`/api/compare?base=${head}&head=${head}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe(CACHE.private)
  })

  it('errors and unknown paths are not cached', async () => {
    t = await startServer()
    const { chapter } = await setup()
    expect((await headers(`${t.url}/api/articles/alpha/99999`)).get('cache-control')).toBe('no-cache')
    expect((await headers(`${t.url}/api/comments/alpha/${chapter}`)).get('cache-control')).toBe('no-cache')
    expect((await headers(`${t.url}/sh/abcd`)).get('cache-control') ?? '').not.toContain('s-maxage')
  })

  it('public responses never set a cookie, even for a signed-in admin (no session renewal on public reads)', async () => {
    t = await startServer()
    const { chapter, head } = await setup()
    for (const path of ['/api/site', `/api/articles/alpha/${chapter}`, `/api/compare?base=${head}&head=${head}`]) {
      const r = await t.api(path)
      expect(r.headers.get('set-cookie'), path).toBeNull()
    }
  })

  it('images are content-addressed and immutable', async () => {
    t = await startServer()
    // the seeded example article embeds an image: take its address from the rendered article
    const html = (await json<{ content: { html: string } }>(fetch(`${t.url}/api/articles/${encodeURIComponent('示例')}/1`))).content.html
    const hash = /\/images\/([0-9a-f]{32})/.exec(html)![1]!
    expect((await headers(`${t.url}/images/${hash}`)).get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
})
