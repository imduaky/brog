import { afterEach, describe, expect, it } from 'vitest'
import { QUERIES } from '../src/server/comments/github.ts'
import type { CommentItem, CommentSettings, CommentsResponse, CommentTestStep } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

const TOKEN = 'ghp_test_token'

interface FakeComment {
  id: string
  body: string
  createdAt: string
  url: string
  author: { login: string; avatarUrl: string } | null
}
interface FakeDiscussion {
  id: string
  number: number
  url: string
  title: string
  comments: FakeComment[]
}

/**
 * A stand-in for GitHub's GraphQL endpoint. It answers the operations in QUERIES and
 * keeps everything in memory, so tests can inspect what the server asked GitHub to do.
 */
function fakeGitHub() {
  const state = {
    token: TOKEN,
    repos: {
      'owner/blog-comments': {
        id: 'R_blog',
        isPrivate: false,
        discussionsEnabled: true,
        categories: [
          { id: 'C_ann', name: 'Announcements' },
          { id: 'C_qa', name: 'Q&A' },
        ],
      },
      'owner/other': {
        id: 'R_other',
        isPrivate: true,
        discussionsEnabled: true,
        categories: [{ id: 'C_gen', name: 'General' }],
      },
      'owner/no-discussions': { id: 'R_nod', isPrivate: false, discussionsEnabled: false, categories: [] as { id: string; name: string }[] },
    } as Record<string, { id: string; isPrivate: boolean; discussionsEnabled: boolean; categories: { id: string; name: string }[] }>,
    discussions: new Map<string, FakeDiscussion>(),
    calls: {} as Record<string, number>,
    seq: 0,
  }
  const count = (k: string) => (state.calls[k] = (state.calls[k] ?? 0) + 1)
  const repoById = (id: string) => Object.entries(state.repos).find(([, r]) => r.id === id)

  const reply = (data: unknown, errors?: { message: string; type?: string }[], status = 200) =>
    new Response(JSON.stringify(errors ? { data, errors } : { data }), { status, headers: { 'content-type': 'application/json' } })

  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${state.token}`) {
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    }
    const { query, variables: v } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, any> }
    switch (query) {
      case QUERIES.viewer:
        count('viewer')
        return reply({ viewer: { login: 'bot' } })
      case QUERIES.repository: {
        count('repository')
        const r = state.repos[`${v.owner}/${v.name}`]
        if (!r) return reply({ repository: null }, [{ message: 'Could not resolve to a Repository', type: 'NOT_FOUND' }])
        return reply({
          repository: {
            id: r.id,
            isPrivate: r.isPrivate,
            hasDiscussionsEnabled: r.discussionsEnabled,
            discussionCategories: { nodes: r.categories },
          },
        })
      }
      case QUERIES.createDiscussion: {
        count('createDiscussion')
        const hit = repoById(v.repositoryId)
        if (!hit || !hit[1].categories.some((c) => c.id === v.categoryId)) {
          return reply({ createDiscussion: null }, [{ message: 'Category not found' }])
        }
        const n = ++state.seq
        const d: FakeDiscussion = { id: `D_${n}`, number: n, url: `https://github.com/${hit[0]}/discussions/${n}`, title: v.title, comments: [] }
        state.discussions.set(d.id, d)
        return reply({ createDiscussion: { discussion: { id: d.id, number: d.number, url: d.url } } })
      }
      case QUERIES.discussionComments: {
        count('discussionComments')
        const d = state.discussions.get(v.id)
        if (!d) return reply({ node: null }, [{ message: 'Could not resolve to a node', type: 'NOT_FOUND' }])
        return reply({ node: { comments: { totalCount: d.comments.length, nodes: d.comments } } })
      }
      case QUERIES.discussionCommentCount: {
        count('discussionCommentCount')
        const d = state.discussions.get(v.id)
        if (!d) return reply({ node: null }, [{ message: 'Could not resolve to a node', type: 'NOT_FOUND' }])
        return reply({ node: { comments: { totalCount: d.comments.length } } })
      }
      case QUERIES.addComment: {
        count('addComment')
        const d = state.discussions.get(v.discussionId)
        if (!d) return reply({ addDiscussionComment: null }, [{ message: 'Could not resolve to a node' }])
        const n = ++state.seq
        const comment: FakeComment = {
          id: `DC_${n}`,
          body: v.body,
          createdAt: new Date().toISOString(),
          url: `${d.url}#discussioncomment-${n}`,
          author: { login: 'bot', avatarUrl: 'https://avatars.example/bot' },
        }
        d.comments.push(comment)
        return reply({ addDiscussionComment: { comment } })
      }
      case QUERIES.deleteComment: {
        count('deleteComment')
        for (const d of state.discussions.values()) {
          const i = d.comments.findIndex((c) => c.id === v.id)
          if (i >= 0) {
            d.comments.splice(i, 1)
            return reply({ deleteDiscussionComment: { clientMutationId: null } })
          }
        }
        return reply({ deleteDiscussionComment: null }, [{ message: 'Could not resolve to a node' }])
      }
    }
    return reply(null, [{ message: `unexpected operation: ${query.slice(0, 40)}` }], 500)
  }
  return { fetch: fetch as typeof globalThis.fetch, state }
}

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

async function publishedArticle(s: TestServer) {
  const c = await json<{ chapter: number }>(s.api('/api/admin/chapters', { method: 'POST', json: { series: 'alpha', title: 'First' } }))
  await publishFile(s, `alpha/${c.chapter}/content.md`, 'Body.\n')
  return c.chapter
}

const saveSettings = (s: TestServer, body: { enabled: boolean; repo: string; categoryId: string }) =>
  s.api('/api/admin/comments/settings', { method: 'PUT', json: body })

describe('comments: off by default', () => {
  it('reports off, hides comments from readers and refuses posts, even with a token present', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    const chapter = await publishedArticle(t)
    const site = await json<{ comments: { enabled: boolean } }>(fetch(`${t.url}/api/site`))
    expect(site.comments.enabled).toBe(false)
    expect(await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))).toEqual({ enabled: false, total: 0, comments: [] })
    const post = await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'hi' } })
    expect(post.status).toBe(403)
    const s = await json<CommentSettings>(t.api('/api/admin/comments/settings'))
    expect(s).toMatchObject({ enabled: false, active: false, tokenConfigured: true })
    expect(gh.state.calls).toEqual({})
  })

  it('never returns the token', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    const text = await (await t.api('/api/admin/comments/settings')).text()
    expect(text).not.toContain(TOKEN)
  })
})

describe('comments: configuration', () => {
  it('refuses to switch on without a token', async () => {
    t = await startServer({}, {})
    await t.login()
    const r = await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: string }).error).toContain('BROG_GITHUB_TOKEN')
    const s = await json<CommentSettings>(t.api('/api/admin/comments/settings'))
    expect(s).toMatchObject({ enabled: false, active: false, tokenConfigured: false })
  })

  it('checks the repository and the category on GitHub when saved', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    expect((await saveSettings(t, { enabled: false, repo: 'owner/missing', categoryId: '' })).status).toBe(404)
    expect((await saveSettings(t, { enabled: false, repo: 'owner/no-discussions', categoryId: '' })).status).toBe(400)
    expect((await saveSettings(t, { enabled: false, repo: 'owner/blog-comments', categoryId: 'C_nope' })).status).toBe(400)
    expect((await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: '' })).status).toBe(400)
    expect((await saveSettings(t, { enabled: false, repo: 'not a repo', categoryId: '' })).status).toBe(400)

    const saved = await json<CommentSettings>(
      saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_qa' }).then((r) => {
        expect(r.status).toBe(200)
        return r
      }),
    )
    expect(saved).toMatchObject({ enabled: true, active: true, repo: 'owner/blog-comments', categoryId: 'C_qa', categoryName: 'Q&A' })
    const site = await json<{ comments: { enabled: boolean } }>(fetch(`${t.url}/api/site`))
    expect(site.comments.enabled).toBe(true)
  })

  it('lists the repository categories for the admin', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    const r = await json<{ repoId: string; categories: { id: string; name: string }[] }>(
      t.api('/api/admin/comments/categories?repo=owner%2Fblog-comments'),
    )
    expect(r.repoId).toBe('R_blog')
    expect(r.categories.map((c) => c.name)).toEqual(['Announcements', 'Q&A'])
  })

  it('a different repository forgets the threads of the old one', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'first' } })
    expect((await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))).total).toBe(1)
    await saveSettings(t, { enabled: true, repo: 'owner/other', categoryId: 'C_gen' })
    expect((await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))).total).toBe(0)
  })
})

describe('comments: test (read-only check)', () => {
  it('runs every step against a working setup, and writes nothing on GitHub', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: false, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const r = await json<{ steps: CommentTestStep[] }>(t.api('/api/admin/comments/test', { method: 'POST' }))
    const byKey = Object.fromEntries(r.steps.map((s) => [s.key, s]))
    expect(byKey.token!.ok).toBe(true)
    expect(byKey.viewer).toMatchObject({ ok: true, detail: '已以 bot 的身份连接' })
    expect(byKey.repo!.ok).toBe(true)
    expect(byKey.category).toMatchObject({ ok: true })
    expect(byKey.threads!.ok).toBeNull()
    expect(byKey.write!.ok).toBeNull()
    expect(gh.state.calls.createDiscussion).toBeUndefined()
    expect(gh.state.calls.addComment).toBeUndefined()
  })

  it('reads the comment count once a discussion exists', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'x' } })
    const r = await json<{ steps: CommentTestStep[] }>(t.api('/api/admin/comments/test', { method: 'POST' }))
    expect(r.steps.find((s) => s.key === 'threads')).toMatchObject({ ok: true, detail: '讨论 #1 可读取，共 1 条评论' })
  })

  it('shows which step fails and skips the rest when the token is invalid', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: false, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    gh.state.token = 'revoked'
    const r = await json<{ steps: CommentTestStep[] }>(t.api('/api/admin/comments/test', { method: 'POST' }))
    expect(r.steps.map((s) => [s.key, s.ok])).toEqual([
      ['token', true],
      ['viewer', false],
      ['repo', null],
      ['category', null],
      ['threads', null],
      ['write', null],
    ])
    expect(r.steps[1]!.detail).toBe('令牌无效或已过期')
  })

  it('reports a missing token and a missing repository without calling GitHub', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: undefined, fetch: gh.fetch })
    await t.login()
    const none = await json<{ steps: CommentTestStep[] }>(t.api('/api/admin/comments/test', { method: 'POST' }))
    expect(none.steps[0]).toMatchObject({ key: 'token', ok: false })
    expect(none.steps.slice(1).every((s) => s.ok === null)).toBe(true)
    expect(gh.state.calls).toEqual({})
  })

  it('a configured repository that is gone is reported at the repo step', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: false, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    delete gh.state.repos['owner/blog-comments']
    const r = await json<{ steps: CommentTestStep[] }>(t.api('/api/admin/comments/test', { method: 'POST' }))
    expect(r.steps.find((s) => s.key === 'repo')).toMatchObject({ ok: false, detail: '找不到 owner/blog-comments，或令牌无权访问' })
  })
})

describe('comments: readers', () => {
  it('the first comment creates the discussion, later comments reuse it', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)

    const first = await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客甲', text: '第一条' } })
    expect(first.status).toBe(201)
    expect(gh.state.calls.createDiscussion).toBe(1)
    const discussion = [...gh.state.discussions.values()][0]!
    expect(discussion.title).toBe(`[brog] alpha/${chapter}`)
    expect(discussion.comments[0]!.body).toBe('**访客甲**\n\n第一条')

    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客乙', text: '第二条' } })
    expect(gh.state.calls.createDiscussion).toBe(1)
    expect(gh.state.calls.addComment).toBe(2)

    const list = await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))
    expect(list.total).toBe(2)
    expect(list.comments.map((c: CommentItem) => [c.name, c.guest, c.body])).toEqual([
      ['访客甲', true, '第一条'],
      ['访客乙', true, '第二条'],
    ])
  })

  it('shows comments written on GitHub by their login, not as guests', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'seed' } })
    const d = [...gh.state.discussions.values()][0]!
    d.comments.push({ id: 'DC_gh', body: 'written on GitHub\r\nsecond line', createdAt: new Date().toISOString(), url: 'javascript:alert(1)', author: { login: 'young', avatarUrl: 'https://a' } })
    gh.state.calls = {}
    const list = await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))
    const own = list.comments.find((c) => c.id === 'DC_gh')!
    expect(own).toMatchObject({ name: 'young', guest: false, avatarUrl: 'https://a', body: 'written on GitHub\nsecond line', url: '' })
  })

  it('rejects invalid names and texts', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    const post = (json: unknown) => t!.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json })
    expect((await post({ name: 'a*b', text: 'x' })).status).toBe(400)
    expect((await post({ name: '', text: 'x' })).status).toBe(400)
    expect((await post({ name: 'ok', text: '   ' })).status).toBe(400)
    expect((await post({ name: 'ok', text: 'x'.repeat(2001) })).status).toBe(400)
    expect(gh.state.calls.addComment).toBeUndefined()
  })

  it('limits posts to five attempts per IP in ten minutes', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    const post = () => t!.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'x' } })
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(201)
    expect((await post()).status).toBe(429)
  })

  it('unpublished or unknown articles have no comments', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    expect((await fetch(`${t.url}/api/comments/alpha/9`)).status).toBe(404)
    expect((await t.api('/api/comments/alpha/9', { method: 'POST', json: { name: '访客', text: 'x' } })).status).toBe(404)
  })

  it('caches the comment list for a minute, and a new comment refreshes it', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'x' } })
    gh.state.calls = {}
    await fetch(`${t.url}/api/comments/alpha/${chapter}`)
    await fetch(`${t.url}/api/comments/alpha/${chapter}`)
    expect(gh.state.calls.discussionComments).toBe(1)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'y' } })
    const list = await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))
    expect(list.total).toBe(2)
  })
})

describe('comments: admin moderation', () => {
  it('deletes a comment on GitHub; readers cannot', async () => {
    const gh = fakeGitHub()
    t = await startServer({}, { githubToken: TOKEN, fetch: gh.fetch })
    await t.login()
    await saveSettings(t, { enabled: true, repo: 'owner/blog-comments', categoryId: 'C_ann' })
    const chapter = await publishedArticle(t)
    await t.api(`/api/comments/alpha/${chapter}`, { method: 'POST', json: { name: '访客', text: 'spam' } })
    const id = [...gh.state.discussions.values()][0]!.comments[0]!.id
    expect((await fetch(`${t.url}/api/admin/comments/${id}`, { method: 'DELETE', headers: { 'x-brog-request': '1' } })).status).toBe(401)
    expect((await t.api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })).status).toBe(200)
    expect(gh.state.discussions.size).toBe(1)
    expect([...gh.state.discussions.values()][0]!.comments).toHaveLength(0)
    expect((await json<CommentsResponse>(fetch(`${t.url}/api/comments/alpha/${chapter}`))).total).toBe(0)
  })
})
