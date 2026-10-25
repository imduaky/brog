import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticleBundle, CommitInfo, WorkspaceStatus } from '../src/shared/types.ts'
import { git, startServer, type TestServer } from './helpers.ts'

let t: TestServer
beforeEach(async () => {
  t = await startServer()
})
afterEach(async () => {
  await t.close()
})

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function newChapter(title = '第一篇') {
  return json<{ series: string; chapter: number }>(
    await t.api('/api/admin/chapters', { method: 'POST', json: { series: 'series-a', seriesTitle: 'series-a', title } }),
  )
}

async function commitAll(message: string) {
  return json<{ oid: string }>(await t.api('/api/admin/commit', { method: 'POST', json: { message, all: true } }))
}

describe('auth', () => {
  it('rejects admin API without a session and wrong passwords', async () => {
    expect((await t.api('/api/admin/status')).status).toBe(401)
    const r = await t.api('/api/auth/login', { method: 'POST', json: { password: 'a'.repeat(64) } })
    expect(r.status).toBe(401)
  })

  it('logs in with sha256(password) and sets a 7 day httpOnly cookie', async () => {
    await t.login()
    const s = await json<{ admin: boolean; expiresAt: number }>(await t.api('/api/auth/session'))
    expect(s.admin).toBe(true)
    expect(s.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86400_000)
  })

  it('requires the CSRF header on mutations', async () => {
    const r = await fetch(`${t.url}/api/auth/login`, { method: 'POST', body: '{}' })
    expect(r.status).toBe(403)
  })
})

describe('publishing workflow', () => {
  beforeEach(() => t.login())

  it('only shows published content to readers', async () => {
    const { series, chapter } = await newChapter()
    await t.api('/api/admin/file', {
      method: 'PUT',
      json: { path: `${series}/${chapter}/content.md`, content: '# 第一篇\n\n正文 v1\n' },
    })
    await commitAll('add first chapter')
    let r = await t.api(`/api/articles/${encodeURIComponent(series)}/${chapter}`)
    expect(r.status).toBe(404)

    const status = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(status.unpublished).toHaveLength(1)
    await json(await t.api('/api/admin/publish', { method: 'POST' }))

    r = await t.api(`/api/articles/${encodeURIComponent(series)}/${chapter}`)
    const bundle = await json<ArticleBundle>(r)
    expect(bundle.meta.title).toBe('第一篇')
    expect(bundle.content.html).toContain('正文 v1')
    expect(bundle.history).toHaveLength(1)
    expect(bundle.series.title).toBe('series-a')

    const list = await json<{ title: string }[]>(await t.api('/api/articles'))
    expect(list.map((a) => a.title)).toContain('第一篇')
  })

  it('lets readers open older published versions but not drafts', async () => {
    const { series, chapter } = await newChapter()
    const file = `${series}/${chapter}/content.md`
    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'v1\n' } })
    const c1 = await commitAll('v1')
    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'v2\n' } })
    await commitAll('v2')
    await t.api('/api/admin/publish', { method: 'POST' })
    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'draft\n' } })
    const draft = await commitAll('draft')

    const base = `/api/articles/${encodeURIComponent(series)}/${chapter}/content`
    expect((await json<{ html: string }>(await t.api(base))).html).toContain('v2')
    expect((await json<{ html: string }>(await t.api(`${base}?rev=${c1.oid}`))).html).toContain('v1')
    expect((await t.api(`${base}?rev=${draft.oid}`)).status).toBe(404)
  })

  it('supports reset --soft/--mixed/--hard and revert', async () => {
    const { series, chapter } = await newChapter()
    const file = `${series}/${chapter}/content.md`
    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'v1\n' } })
    const c1 = await commitAll('v1')
    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'v2\n' } })
    const c2 = await commitAll('v2')

    await json(await t.api('/api/admin/reset', { method: 'POST', json: { rev: c1.oid } }))
    let s = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(s.head).toBe(c1.oid)
    expect(s.changes).toEqual([{ index: 'M', worktree: ' ', path: file }])

    await json(await t.api('/api/admin/reset', { method: 'POST', json: { rev: c2.oid, mode: 'hard' } }))
    await json(await t.api('/api/admin/reset', { method: 'POST', json: { rev: c1.oid, mode: 'mixed' } }))
    s = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(s.changes).toEqual([{ index: ' ', worktree: 'M', path: file }])

    await json(await t.api('/api/admin/reset', { method: 'POST', json: { rev: c1.oid, mode: 'hard' } }))
    s = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(s.changes).toEqual([])

    await t.api('/api/admin/file', { method: 'PUT', json: { path: file, content: 'v3\n' } })
    const c3 = await commitAll('v3')
    const rv = await json<{ oid: string }>(await t.api('/api/admin/revert', { method: 'POST', json: { rev: c3.oid } }))
    expect(rv.oid).not.toBe(c3.oid)
    const f = await json<{ content: string }>(await t.api(`/api/admin/file?path=${encodeURIComponent(file)}`))
    expect(f.content).toBe('v1\n')
    const log = await json<CommitInfo[]>(await t.api('/api/admin/log'))
    expect(log[0]!.subject).toMatch(/^Revert "v3"/)
  })

  it('rejects a non-image upload with 400', async () => {
    const { series, chapter } = await newChapter()
    const form = new FormData()
    form.set('file', new Blob([new TextEncoder().encode('not an image')], { type: 'image/png' }), 'x.png')
    form.set('series', series)
    form.set('chapter', String(chapter))
    form.set('markdown', '# A\n')
    form.set('offset', '0')
    const r = await t.api('/api/admin/images', { method: 'POST', body: form })
    expect(r.status).toBe(400)
  })

  it('names pasted images after the heading and serves them by hash', async () => {
    const { series, chapter } = await newChapter()
    const markdown = '# 开始\n\n## 开始第一步\n\n![](img/a.webp)\n\nCURSOR'
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer()
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'paste.png')
    form.set('series', series)
    form.set('chapter', String(chapter))
    form.set('markdown', markdown)
    form.set('offset', String(markdown.indexOf('CURSOR')))
    const up = await json<{ path: string; url: string }>(await t.api('/api/admin/images', { method: 'POST', body: form }))
    expect(up.path).toBe('img/开始-开始第一步_1.webp')
    const img = await fetch(t.url + up.url)
    expect(img.headers.get('content-type')).toBe('image/webp')
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(0)

    await t.api('/api/admin/file', {
      method: 'PUT',
      json: { path: `${series}/${chapter}/content.md`, content: `# 开始\n\n![x](${up.path})\n` },
    })
    await commitAll('image')
    await t.api('/api/admin/publish', { method: 'POST' })
    const bundle = await json<ArticleBundle>(await t.api(`/api/articles/${encodeURIComponent(series)}/${chapter}`))
    expect(bundle.content.html).toContain(`src="${up.url}"`)
  })
})

describe('git server', () => {
  it('serves only the published commit anonymously and accepts token pushes', async () => {
    await t.login()
    const { series, chapter } = await newChapter()
    await commitAll('draft chapter')

    const work = mkdtempSync(path.join(tmpdir(), 'brog-clone-'))
    await git(work, 'clone', '-q', `${t.url}/git/blog.git`, 'anon')
    const anonLog = await git(path.join(work, 'anon'), 'log', '--format=%s')
    expect(anonLog).not.toContain('draft chapter')

    // the full URL needs credentials
    await expect(git(work, 'clone', '-q', `${t.url}/git/full/blog.git`, 'nope')).rejects.toThrow()
    // anonymous push is refused
    writeFileSync(path.join(work, 'anon', 'x.md'), 'x')
    await git(path.join(work, 'anon'), 'add', '.')
    await git(path.join(work, 'anon'), 'commit', '-q', '-m', 'anon')
    await expect(git(path.join(work, 'anon'), 'push', '-q', 'origin', 'main')).rejects.toThrow()

    const { token } = await json<{ token: string }>(await t.api('/api/admin/tokens', { method: 'POST', json: { name: 'ci' } }))
    const authed = `${t.url.replace('://', `://young:${token}@`)}/git/full/blog.git`
    await git(work, 'clone', '-q', authed, 'owner')
    const dir = path.join(work, 'owner')
    expect(await git(dir, 'log', '--format=%s')).toContain('draft chapter')

    // Web has an uncommitted edit in another file while the push lands: it is re-applied on top.
    const draftFile = `${series}/${chapter}/content.md`
    await t.api('/api/admin/file', { method: 'PUT', json: { path: draftFile, content: '# web draft\n' } })
    writeFileSync(path.join(dir, 'pushed.md'), 'from git\n')
    await git(dir, 'add', '.')
    await git(dir, 'commit', '-q', '-m', 'pushed from git')
    await git(dir, 'push', '-q', 'origin', 'main')

    const s = await json<WorkspaceStatus>(await t.api('/api/admin/status'))
    expect(s.unpublished.map((c) => c.subject)).toContain('pushed from git')
    expect(s.changes).toEqual([{ index: ' ', worktree: 'M', path: draftFile }])
    const f = await json<{ content: string }>(await t.api('/api/admin/file?path=pushed.md'))
    expect(f.content).toBe('from git\n')

    // other branches are rejected
    await expect(git(dir, 'push', '-q', 'origin', 'main:feature')).rejects.toThrow()
    // wrong token
    const bad = `${t.url.replace('://', '://young:brog_wrong@')}/git/full/blog.git`
    await expect(git(work, 'clone', '-q', bad, 'bad')).rejects.toThrow()

    // After publishing, anonymous fetch sees the new commits.
    await t.api('/api/admin/publish', { method: 'POST' })
    await git(path.join(work, 'anon'), 'fetch', '-q', 'origin')
    expect(await git(path.join(work, 'anon'), 'log', '--format=%s', 'origin/main')).toContain('pushed from git')
    expect(readFileSync(path.join(dir, 'pushed.md'), 'utf8')).toBe('from git\n')
  })
})
