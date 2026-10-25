import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticleSummary, ChapterMeta, SiteInfo } from '../src/shared/types.ts'
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

async function article(title: string) {
  const c = await json<{ series: string; chapter: number }>(
    await t.api('/api/admin/chapters', { method: 'POST', json: { series: 'series-a', seriesTitle: 'series-a', title } }),
  )
  await t.api('/api/admin/file', { method: 'PUT', json: { path: `series-a/${c.chapter}/content.md`, content: `# ${title}\n\nFirst paragraph of the body.\n` } })
  return c
}

describe('article preview', () => {
  it('uses the hand-written preview text and theme on the home list, before summary and content', async () => {
    const c = await article('Previewed')
    await t.api(`/api/admin/meta/series-a/${c.chapter}`, {
      method: 'PUT',
      json: { title: 'Previewed', tags: [], summary: 'The summary', preview: { text: 'Card text by hand', theme: { light: '#c8d8e6', dark: '#2d3d4d' } } },
    })
    await t.api('/api/admin/commit', { method: 'POST', json: { message: 'p', all: true } })
    await t.api('/api/admin/publish', { method: 'POST' })
    const [a] = await json<ArticleSummary[]>(await anon('/api/articles'))
    expect(a!.summary).toBe('Card text by hand')
    expect(a!.theme).toEqual({ light: '#c8d8e6', dark: '#2d3d4d' })
  })

  it('falls back to the summary, then the first paragraph, when no preview text is set', async () => {
    const c = await article('Plain')
    await t.api(`/api/admin/meta/series-a/${c.chapter}`, { method: 'PUT', json: { title: 'Plain', tags: [], summary: 'Only summary' } })
    await t.api('/api/admin/commit', { method: 'POST', json: { message: 'p', all: true } })
    await t.api('/api/admin/publish', { method: 'POST' })
    const [a] = await json<ArticleSummary[]>(await anon('/api/articles'))
    expect(a!.summary).toBe('Only summary')
    expect(a!.theme).toBeNull()
  })

  it('derives the dark color when only the light one is given, and does not store empty preview blocks', async () => {
    const c = await article('Derived')
    await t.api(`/api/admin/meta/series-a/${c.chapter}`, {
      method: 'PUT',
      json: { title: 'Derived', tags: [], preview: { text: '', theme: { light: '#ECE1C6' } } },
    })
    const meta = await json<ChapterMeta>(await t.api(`/api/admin/meta/series-a/${c.chapter}`))
    expect(meta.preview).toBeUndefined()

    await t.api(`/api/admin/meta/series-a/${c.chapter}`, {
      method: 'PUT',
      json: { title: 'Derived', tags: [], preview: { theme: { light: '#ECE1C6', dark: '' as unknown as string } } },
    }).then((r) => expect(r.status).toBe(400))
    await t.api(`/api/admin/meta/series-a/${c.chapter}`, {
      method: 'PUT',
      json: { title: 'Derived', tags: [], preview: { theme: { light: '#ece1c6', dark: '#3a3326' } } },
    })
    const again = await json<ChapterMeta>(await t.api(`/api/admin/meta/series-a/${c.chapter}`))
    expect(again.preview?.theme).toEqual({ light: '#ece1c6', dark: '#3a3326' })
  })
})

describe('site appearance', () => {
  it('defaults to the warm paper in both modes', async () => {
    const info = await json<SiteInfo>(await anon('/api/site'))
    expect(info.settings.paper).toEqual({ light: '#f4ecd8', dark: '#1f1c17' })
    expect(info.settings.home.color).toEqual({ light: '#f4ecd8', dark: '#1f1c17' })
  })

  it('rejects malformed colors', async () => {
    const base = await json<SiteInfo>(await anon('/api/site'))
    const body = (patch: object) => ({ ...base.settings, ...patch })
    expect((await t.api('/api/admin/site-settings', { method: 'PUT', json: body({ paper: { light: 'red', dark: '#000000' } }) })).status).toBe(400)
    expect((await t.api('/api/admin/site-settings', { method: 'PUT', json: body({ home: { color: { light: '#fff', dark: '#000000' } } }) })).status).toBe(400)
  })

  it('saves the home color per mode', async () => {
    const base = await json<SiteInfo>(await anon('/api/site'))
    const saved = await t.api('/api/admin/site-settings', {
      method: 'PUT',
      json: { ...base.settings, home: { color: { light: '#ffffff', dark: '#101010' } } },
    })
    expect(saved.status).toBe(200)
    expect((await json<SiteInfo>(await anon('/api/site'))).settings.home.color).toEqual({ light: '#ffffff', dark: '#101010' })
  })
})
