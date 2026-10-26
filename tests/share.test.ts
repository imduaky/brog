import { afterEach, describe, expect, it } from 'vitest'
import type { ShareLink } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

let t: TestServer | null = null
afterEach(async () => {
  await t?.close()
  t = null
})

const json = async <T>(r: Response | Promise<Response>) => (await r).json() as Promise<T>
const ID = /^[A-Za-z0-9]{4}$/

async function publishFile(s: TestServer, file: string, content: string) {
  await s.api('/api/admin/file', { method: 'PUT', json: { path: file, content } })
  await s.api('/api/admin/commit', { method: 'POST', json: { message: `add ${file}`, all: true } })
  await s.api('/api/admin/publish', { method: 'POST' })
}

async function publishedArticle(s: TestServer): Promise<number> {
  const c = await json<{ chapter: number }>(s.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'First' } }))
  await publishFile(s, `alpha/${c.chapter}/content.md`, 'Body.\n')
  return c.chapter
}

/** Follows the link without following the redirect, so the target can be checked. */
const visit = (url: string) => fetch(url, { redirect: 'manual' })

describe('share links', () => {
  it('creates a 4-character link for a published article, on the request origin by default', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const r = await t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' })
    expect(r.status).toBe(201)
    const link = (await r.json()) as ShareLink
    expect(link.id).toMatch(ID)
    expect(link.url).toBe(`${t.url}/sh/${link.id}`)
    expect(typeof link.createdAt).toBe('number')
  })

  it('uses the share domain when one is set, and the main site domain otherwise', async () => {
    t = await startServer({ baseUrl: 'https://blog.test', shareOrigin: '' })
    await t.login()
    const chapter = await publishedArticle(t)
    const main = (await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))).url
    expect(main).toMatch(/^https:\/\/blog\.test\/sh\/[A-Za-z0-9]{4}$/)

    await t.server.ctx.settings.set({ ...t.server.ctx.settings.get(), shareOrigin: 'https://s.test' })
    const short = (await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))).url
    expect(short).toMatch(/^https:\/\/s\.test\/sh\/[A-Za-z0-9]{4}$/)
    // The list shows every link under the domain in effect now; the id is what identifies a link.
    const listed = await json<ShareLink[]>(t.api(`/api/admin/articles/alpha/${chapter}/shares`))
    expect(listed.map((l) => l.url)).toEqual(
      [main, short].map((u) => u.replace(/^https:\/\/blog\.test\//, 'https://s.test/')),
    )
  })

  it('rejects a share domain with a path', async () => {
    t = await startServer()
    await t.login()
    const current = await json<Record<string, unknown>>(t.api('/api/admin/server-settings'))
    const r = await t.api('/api/admin/server-settings', { method: 'PUT', json: { ...current, shareOrigin: 'https://s.test/x' } })
    expect(r.status).toBe(400)
  })

  it('redirects a link to the article, without caching the redirect', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const { url } = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    const r = await visit(url)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe(`/s/alpha/${chapter}`)
    expect(r.headers.get('cache-control')).toBe('no-cache')
  })

  it('an unpublished article has no links, and a link stops working when its article is removed', async () => {
    t = await startServer()
    await t.login()
    await t.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'Draft' } })
    expect((await t.api('/api/admin/articles/alpha/1/shares', { method: 'POST' })).status).toBe(409)

    const chapter = await publishedArticle(t)
    const { url } = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    expect((await visit(url)).status).toBe(302)

    await t.api(`/api/admin/file?path=${encodeURIComponent(`alpha/${chapter}`)}`, { method: 'DELETE' })
    await t.api('/api/admin/commit', { method: 'POST', json: { message: 'remove', all: true } })
    await t.api('/api/admin/publish', { method: 'POST' })
    expect((await visit(url)).status).toBe(404)
  })

  it('revoking a link stops it, and revoking twice reports it is gone', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const { id, url } = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    expect((await t.api(`/api/admin/shares/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await visit(url)).status).toBe(404)
    expect((await t.api(`/api/admin/shares/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('unknown or malformed ids answer 404', async () => {
    t = await startServer()
    for (const id of ['abcd', 'ab', 'abcde', 'ab-c', '%20%20%20%20']) {
      expect((await visit(`${t.url}/sh/${id}`)).status, id).toBe(404)
    }
  })

  it('issues distinct ids, all of the right form', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const ids = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const { id } = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
      expect(id).toMatch(ID)
      ids.add(id)
    }
    expect(ids.size).toBe(40)
  })

  it('only the admin can list, create or revoke links', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const { id } = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    expect((await fetch(`${t.url}/api/admin/articles/alpha/${chapter}/shares`)).status).toBe(401)
    expect((await fetch(`${t.url}/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST', headers: { 'x-brog-request': '1' } })).status).toBe(401)
    expect((await fetch(`${t.url}/api/admin/shares/${id}`, { method: 'DELETE', headers: { 'x-brog-request': '1' } })).status).toBe(401)
  })
})

describe('visitor share link', () => {
  const visitorUrl = (chapter: number) => `${t!.url}/api/articles/alpha/${chapter}/share`

  it('readers get one shared link per article, created on the first request and reused after', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    // nobody has asked yet
    expect(await json<{ link: ShareLink | null }>(fetch(visitorUrl(chapter)))).toEqual({ link: null })

    // readers need no login: plain requests with the CSRF header
    const post = () => fetch(visitorUrl(chapter), { method: 'POST', headers: { 'x-brog-request': '1' } })
    const first = await json<ShareLink>(post())
    expect(first).toMatchObject({ visitor: true, id: expect.stringMatching(ID) })
    expect(first.url).toBe(`${t.url}/sh/${first.id}`)
    expect(await json<ShareLink>(post())).toEqual(first)
    expect(await json<{ link: ShareLink }>(fetch(visitorUrl(chapter)))).toEqual({ link: first })
  })

  it('concurrent first requests still produce a single link', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const links = await Promise.all(
      Array.from({ length: 6 }, () => json<ShareLink>(fetch(visitorUrl(chapter), { method: 'POST', headers: { 'x-brog-request': '1' } }))),
    )
    expect(new Set(links.map((l) => l.id)).size).toBe(1)
    const admin = await json<ShareLink[]>(t.api(`/api/admin/articles/alpha/${chapter}/shares`))
    expect(admin.filter((l) => l.visitor)).toHaveLength(1)
  })

  it('the admin can make several links; the visitor link stays one and is listed first', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const visitor = await json<ShareLink>(fetch(visitorUrl(chapter), { method: 'POST', headers: { 'x-brog-request': '1' } }))
    const a = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    const b = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    expect(a.visitor).toBe(false)
    expect(b.visitor).toBe(false)
    const listed = await json<ShareLink[]>(t.api(`/api/admin/articles/alpha/${chapter}/shares`))
    expect(listed.map((l) => [l.id, l.visitor])).toEqual([
      [visitor.id, true],
      [a.id, false],
      [b.id, false],
    ])
  })

  it('an unpublished article has no visitor link', async () => {
    t = await startServer()
    await t.login()
    await t.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'Draft' } })
    expect((await fetch(visitorUrl(1))).status).toBe(409)
    expect((await fetch(visitorUrl(1), { method: 'POST', headers: { 'x-brog-request': '1' } })).status).toBe(409)
  })

  it('a POST without the CSRF header is refused', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    expect((await fetch(visitorUrl(chapter), { method: 'POST' })).status).toBe(403)
  })

  it('revoking the visitor link makes the next request issue a new one', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const old = await json<ShareLink>(fetch(visitorUrl(chapter), { method: 'POST', headers: { 'x-brog-request': '1' } }))
    expect((await t.api(`/api/admin/shares/${old.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await json<{ link: ShareLink | null }>(fetch(visitorUrl(chapter)))).toEqual({ link: null })
    const fresh = await json<ShareLink>(fetch(visitorUrl(chapter), { method: 'POST', headers: { 'x-brog-request': '1' } }))
    expect(fresh.id).not.toBe(old.id)
    expect((await visit(old.url)).status).toBe(404)
    expect((await visit(fresh.url)).status).toBe(302)
  })
})

describe('readers create the visitor link but cannot remove it', () => {
  const visitorUrl = (chapter: number) => `${t!.url}/api/articles/alpha/${chapter}/share`
  const readerRequest = (url: string, method: string) => fetch(url, { method, headers: { 'x-brog-request': '1' } })

  it('a reader cannot remove the visitor link, and it keeps working', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const link = await json<ShareLink>(readerRequest(visitorUrl(chapter), 'POST'))
    expect((await readerRequest(visitorUrl(chapter), 'DELETE')).status).toBe(404)
    expect((await visit(link.url)).status).toBe(302)
    expect(await json<{ link: ShareLink }>(fetch(visitorUrl(chapter)))).toEqual({ link: link })
  })

  it('a reader cannot remove an admin link either', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const admin = await json<ShareLink>(t.api(`/api/admin/articles/alpha/${chapter}/shares`, { method: 'POST' }))
    expect((await readerRequest(visitorUrl(chapter), 'DELETE')).status).toBe(404)
    expect((await visit(admin.url)).status).toBe(302)
  })

  it('the admin can remove the visitor link, and the next reader request makes a new one', async () => {
    t = await startServer()
    await t.login()
    const chapter = await publishedArticle(t)
    const old = await json<ShareLink>(readerRequest(visitorUrl(chapter), 'POST'))
    expect((await t.api(`/api/admin/shares/${old.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await visit(old.url)).status).toBe(404)
    const fresh = await json<ShareLink>(readerRequest(visitorUrl(chapter), 'POST'))
    expect(fresh.id).not.toBe(old.id)
  })
})
