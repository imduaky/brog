import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticleSummary, TagCount, TagRef } from '../src/shared/types.ts'
import { startServer, type TestServer } from './helpers.ts'

let t: TestServer
beforeEach(async () => {
  t = await startServer()
  await t.login()
})
afterEach(async () => {
  await t.close()
})

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as T
}
const anon = (p: string) => fetch(t.url + p)

async function article(series: string, title: string, tags: string[]) {
  const c = await json<{ series: string; chapter: number }>(
    await t.api('/api/admin/chapters', { method: 'POST', json: { series, seriesTitle: series, title, tags } }),
  )
  await t.api(`/api/admin/meta/${encodeURIComponent(series)}/${c.chapter}`, {
    method: 'PUT',
    json: { title, tags },
  })
  await t.api('/api/admin/file', { method: 'PUT', json: { path: `${series}/${c.chapter}/content.md`, content: `# ${title}\n` } })
  return c
}

const publish = async () => {
  await t.api('/api/admin/commit', { method: 'POST', json: { message: 'content', all: true } })
  await t.api('/api/admin/publish', { method: 'POST' })
}

describe('tag catalog', () => {
  it('adds tags to the catalog and rejects duplicates and invalid names', async () => {
    const added = await json<TagRef>(await t.api('/api/admin/tags', { method: 'POST', json: { name: '  算法  ' } }))
    expect(added.name).toBe('算法')
    expect(added.key).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect((await t.api('/api/admin/tags', { method: 'POST', json: { name: '算法' } })).status).toBe(409)
    expect((await t.api('/api/admin/tags', { method: 'POST', json: { name: 'a,b' } })).status).toBe(400)
    expect((await t.api('/api/admin/tags', { method: 'POST', json: { name: '' } })).status).toBe(400)
    expect((await t.api('/api/admin/tags', { method: 'POST', json: { name: 'x'.repeat(31) } })).status).toBe(400)
  })

  it('lists unused tags for the admin but only used tags for readers', async () => {
    await t.api('/api/admin/tags', { method: 'POST', json: { name: '未使用' } })
    await article('series-a', 'First', ['使用中'])
    await publish()
    const reader = await json<TagCount[]>(await anon('/api/tags'))
    // The example article ships with tags too, so check membership rather than the whole list.
    expect(reader.map((x) => x.name)).toContain('使用中')
    expect(reader.map((x) => x.name)).not.toContain('未使用')
    const admin = await json<TagCount[]>(await t.api('/api/admin/tags'))
    expect(admin.map((x) => x.name)).toEqual(expect.arrayContaining(['使用中', '未使用']))
    expect(admin.find((x) => x.name === '未使用')!.count).toBe(0)
  })

  it('registers tags written through the meta editor', async () => {
    await article('series-a', 'Second', ['新标签'])
    const admin = await json<TagCount[]>(await t.api('/api/admin/tags'))
    expect(admin.map((x) => x.name)).toContain('新标签')
  })
})

describe('tag filtering', () => {
  it('keeps articles that carry every selected tag, by key', async () => {
    await article('series-a', 'Both', ['甲', '乙'])
    await article('series-a', 'Only first', ['甲'])
    await article('series-a', 'Neither', [])
    await publish()
    const tags = await json<TagCount[]>(await anon('/api/tags'))
    const key = (n: string) => tags.find((x) => x.name === n)!.key

    const one = await json<ArticleSummary[]>(await anon(`/api/articles?tags=${key('甲')}`))
    expect(one.map((a) => a.title).sort()).toEqual(['Both', 'Only first'])

    const both = await json<ArticleSummary[]>(await anon(`/api/articles?tags=${key('甲')},${key('乙')}`))
    expect(both.map((a) => a.title)).toEqual(['Both'])
    expect(both[0]!.tags.map((x) => x.key)).toContain(key('乙'))

    const unknown = await json<ArticleSummary[]>(await anon('/api/articles?tags=doesnotexist'))
    expect(unknown).toEqual([])
  })
})

describe('tag rename', () => {
  it('keeps the key, rewrites the name in meta files and publishes the new name', async () => {
    await article('series-a', 'Renamed', ['旧名'])
    await article('series-a', 'Other', ['旧名', '保留'])
    await publish()
    const before = (await json<TagCount[]>(await anon('/api/tags'))).find((x) => x.name === '旧名')!

    const renamed = await json<TagRef>(
      await t.api(`/api/admin/tags/${before.key}`, { method: 'PUT', json: { name: '新名' } }),
    )
    expect(renamed).toEqual({ key: before.key, name: '新名' })

    // Workspace meta is rewritten; readers still see the old name until the next publish.
    const meta = await json<{ tags: string[] }>(await t.api('/api/admin/meta/series-a/1'))
    expect(meta.tags).toEqual(['新名'])
    expect((await json<TagCount[]>(await anon('/api/tags'))).map((x) => x.name)).toContain('旧名')

    await publish()
    const after = await json<TagCount[]>(await anon('/api/tags'))
    expect(after.find((x) => x.key === before.key)!.name).toBe('新名')
    expect(after.find((x) => x.key === before.key)!.count).toBe(2)
    expect(after.map((x) => x.name)).not.toContain('旧名')
  })

  it('refuses a name that another tag already has', async () => {
    await article('series-a', 'A', ['甲', '乙'])
    const tags = await json<TagCount[]>(await t.api('/api/admin/tags'))
    const first = tags.find((x) => x.name === '甲')!
    expect((await t.api(`/api/admin/tags/${first.key}`, { method: 'PUT', json: { name: '乙' } })).status).toBe(409)
    expect((await t.api('/api/admin/tags/missing-key', { method: 'PUT', json: { name: '丙' } })).status).toBe(404)
  })
})
